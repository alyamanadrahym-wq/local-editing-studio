import { date, integer, pgTable, primaryKey, text } from "drizzle-orm/pg-core";

export const aiUsageTable = pgTable("ai_provider_daily_usage", {
  sessionId: text("session_id").notNull(),
  provider: text("provider").notNull(),
  usageDay: date("usage_day").notNull(),
  requestCount: integer("request_count").notNull().default(0),
}, (table) => [
  primaryKey({ columns: [table.sessionId, table.provider, table.usageDay] }),
]);