# Local Editing Studio

A private, local-first workspace for importing footage, planning cuts, reviewing takes, saving versions, and exporting editable video draft packages.

## Run & Operate

- `pnpm --filter @workspace/local-editing-studio run dev` — run the local editing studio through its managed workflow
- `pnpm --filter @workspace/local-editing-studio run typecheck` — check the studio frontend
- `pnpm --filter @workspace/api-server run dev` — run the shared API server
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- The current studio MVP requires no API keys, database, or cloud provider.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)
- Studio: React + Vite, IndexedDB media storage, localStorage project metadata

## Where things live

- `artifacts/local-editing-studio/src/pages/` — studio, assets, script, styles, export, and settings screens
- `artifacts/local-editing-studio/src/lib/store.ts` — local project and settings state
- `artifacts/local-editing-studio/src/lib/local-media.ts` — browser-local media bytes in IndexedDB
- `artifacts/local-editing-studio/src/index.css` — studio theme

## Architecture decisions

- Media is local-first: imported file bytes are kept in IndexedDB and are never sent to the shared API.
- The first planning pass is deterministic and script-driven; it does not claim that cloud transcription or visual AI analysis occurred.
- Provider settings are opt-in placeholders only. Google AI plan/Flow credits are not treated as Gemini API quota.
- Export currently produces an edit-plan manifest and draft SRT captions; native MP4 rendering belongs in the desktop media-engine phase.

## Product

- Import local video, audio, and images.
- Write or paste a script and build a local edit plan.
- Preview video windows, choose takes, and assemble a sequence.
- Save and restore timeline versions.
- Select editing style profiles and configure privacy mode.
- Download a portable JSON edit plan and draft SRT captions.

## User preferences

- Keep the product private and local-first; do not require publishing.
- Prefer free local models and make any cloud-provider use explicit and optional.

## Gotchas

- Blob URLs are session-specific; restore media through IndexedDB rather than treating saved blob URLs as permanent.
- Never represent a timed animation as real AI analysis or MP4 rendering.
- Do not add remote fonts or analytics to the strict local mode.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
