import { Router, type IRouter, type Request, type Response } from "express";
import { createHash, randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import {
  CreateAiConsentBody,
  CreateAiConsentResponse,
  CreateAiSuggestionsBody,
  CreateAiSuggestionsResponse,
  GetAiProvidersResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();
const DAILY_LIMIT = 20;
const CONSENT_TTL_MS = 5 * 60 * 1000;
const consentTokens = new Map<string, { sessionId: string; provider: Provider; digest: string; expiresAt: number }>();

type Provider = "gemini" | "openrouter";

function isConfigured(provider: Provider): boolean {
  const prefix = provider === "gemini" ? "GEMINI" : "OPENROUTER";
  return Boolean(
    process.env[`AI_INTEGRATIONS_${prefix}_BASE_URL`] &&
    process.env[`AI_INTEGRATIONS_${prefix}_API_KEY`],
  );
}

function getSessionId(req: Request, res: Response): string {
  const existing = req.signedCookies?.studio_session;
  if (typeof existing === "string" && existing.length > 0) return existing;
  const sessionId = randomUUID();
  res.cookie("studio_session", sessionId, {
    signed: true,
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    maxAge: 365 * 24 * 60 * 60 * 1000,
  });
  return sessionId;
}

function digestPayload(provider: Provider, script: string): string {
  return createHash("sha256").update(`${provider}\0${script}`, "utf8").digest("hex");
}

async function takeQuota(provider: Provider) {
  const result = await pool.query<{ request_count: number }>(
    `INSERT INTO ai_provider_daily_usage (session_id, provider, usage_day, request_count)
     VALUES ($1, $2, CURRENT_DATE, 1)
     ON CONFLICT (session_id, provider, usage_day)
     DO UPDATE SET request_count = ai_provider_daily_usage.request_count + 1
     WHERE ai_provider_daily_usage.request_count < $3
     RETURNING request_count`,
    ["global-provider-cap", provider, DAILY_LIMIT],
  );
  const used = result.rows[0]?.request_count;
  return used == null ? null : { used, limit: DAILY_LIMIT, remaining: DAILY_LIMIT - used };
}

function isSameOrigin(req: Request): boolean {
  const origin = req.get("origin");
  const host = req.get("host");
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

function parseJsonText(text: string): { hooks: string[]; broll: string[] } {
  const candidate = text.match(/\{[\s\S]*\}/)?.[0] ?? text;
  const parsed = JSON.parse(candidate) as { hooks?: unknown; broll?: unknown };
  const strings = (value: unknown, max: number) =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").slice(0, max) : [];
  return { hooks: strings(parsed.hooks, 5), broll: strings(parsed.broll, 8) };
}

async function askProvider(provider: Provider, script: string) {
  const system = "Return JSON only with hooks (up to 5 improved opening hooks) and broll (up to 8 text-only shot ideas). Never ask for or refer to media files.";
  if (provider === "gemini") {
    const baseUrl = process.env.AI_INTEGRATIONS_GEMINI_BASE_URL!;
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/models/gemini-3-flash-preview:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.AI_INTEGRATIONS_GEMINI_API_KEY! },
      body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: `${system}\n\nSCRIPT:\n${script}` }] }], generationConfig: { responseMimeType: "application/json" } }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`Gemini returned ${response.status}`);
    const data = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    return parseJsonText(data.candidates?.[0]?.content?.parts?.[0]?.text ?? "");
  }

  const response = await fetch(`${process.env.AI_INTEGRATIONS_OPENROUTER_BASE_URL!.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.AI_INTEGRATIONS_OPENROUTER_API_KEY}` },
    body: JSON.stringify({
      model: "qwen/qwen3.8-flash",
      messages: [{ role: "system", content: system }, { role: "user", content: script }],
      response_format: { type: "json_object" },
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`OpenRouter returned ${response.status}`);
  const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  return parseJsonText(data.choices?.[0]?.message?.content ?? "");
}

router.get("/ai/providers", (_req, res): void => {
  res.json(GetAiProvidersResponse.parse({
    gemini: isConfigured("gemini"),
    openrouter: isConfigured("openrouter"),
  }));
});

router.post("/ai/consent", (req, res): void => {
  if (!isSameOrigin(req)) {
    res.status(403).json({ error: "AI requests are only accepted from this local editing studio." });
    return;
  }
  const parsed = CreateAiConsentBody.safeParse(req.body);
  if (!parsed.success || parsed.data.reviewed !== true) {
    res.status(400).json({ error: "The exact text payload must be reviewed and approved." });
    return;
  }
  const sessionId = getSessionId(req, res);
  const consentToken = randomUUID();
  consentTokens.set(consentToken, {
    sessionId,
    provider: parsed.data.provider,
    digest: digestPayload(parsed.data.provider, parsed.data.script),
    expiresAt: Date.now() + CONSENT_TTL_MS,
  });
  res.json(CreateAiConsentResponse.parse({ consentToken, expiresInSeconds: CONSENT_TTL_MS / 1000 }));
});

router.post("/ai/suggestions", async (req, res): Promise<void> => {
  if (!isSameOrigin(req)) {
    res.status(403).json({ error: "AI requests are only accepted from this local editing studio." });
    return;
  }
  const parsed = CreateAiSuggestionsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "A valid script and single-use consent token are required." });
    return;
  }
  const { provider, script, consentToken } = parsed.data;
  const sessionId = getSessionId(req, res);
  const approval = consentTokens.get(consentToken);
  consentTokens.delete(consentToken);
  if (
    !approval ||
    approval.expiresAt < Date.now() ||
    approval.sessionId !== sessionId ||
    approval.provider !== provider ||
    approval.digest !== digestPayload(provider, script)
  ) {
    res.status(403).json({ error: "Consent expired, was already used, or does not match this exact payload." });
    return;
  }
  if (!isConfigured(provider)) {
    res.json(CreateAiSuggestionsResponse.parse({
      provider,
      hooks: [],
      broll: [],
      fallback: true,
      message: `${provider} is not configured. The local workflow remains available.`,
      usage: { used: 0, limit: DAILY_LIMIT, remaining: DAILY_LIMIT },
    }));
    return;
  }
  const quota = await takeQuota(provider);
  if (!quota) {
    res.status(429).json({ error: `Daily ${provider} limit reached. Continue with the local workflow.` });
    return;
  }
  try {
    const suggestions = await askProvider(provider, script);
    res.json(CreateAiSuggestionsResponse.parse({ provider, ...suggestions, usage: quota }));
  } catch (error) {
    req.log.warn({ provider, err: error }, "Optional AI provider request failed");
    res.json(CreateAiSuggestionsResponse.parse({
      provider,
      hooks: [],
      broll: [],
      fallback: true,
      message: `${provider} is unavailable. Nothing else was sent; continue locally.`,
      usage: quota,
    }));
  }
});

export default router;