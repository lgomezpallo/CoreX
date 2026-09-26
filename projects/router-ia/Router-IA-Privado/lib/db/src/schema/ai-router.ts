import { createInsertSchema } from "drizzle-zod";
import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const ROUTER_TASK_TYPES = [
  "chat",
  "coding",
  "reasoning",
  "summarization",
  "vision",
  "document",
] as const;
export type RouterTaskType = (typeof ROUTER_TASK_TYPES)[number];

export const PROVIDER_CAPABILITIES = [
  ...ROUTER_TASK_TYPES,
  "long_context",
  "fast",
] as const;
export type ProviderCapability = (typeof PROVIDER_CAPABILITIES)[number];

export const aiProvidersTable = pgTable(
  "ai_providers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id").notNull(),
    name: text("name").notNull(),
    kind: text("kind").notNull(),
    baseUrl: text("base_url"),
    model: text("model").notNull(),
    apiKeyCiphertext: text("api_key_ciphertext").notNull(),
    apiKeyIv: text("api_key_iv").notNull(),
    apiKeyTag: text("api_key_tag").notNull(),
    apiKeyPreview: text("api_key_preview").notNull(),
    isDefault: boolean("is_default").notNull().default(false),
    capabilities: jsonb("capabilities")
      .$type<ProviderCapability[]>()
      .notNull()
      .default(sql`'["chat"]'::jsonb`),
    priority: integer("priority").notNull().default(50),
    isActive: boolean("is_active").notNull().default(true),
    status: text("status").notNull().default("untested"),
    healthStatus: text("health_status").notNull().default("available"),
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
    cooldownUntil: timestamp("cooldown_until", { withTimezone: true }),
    lastTestAt: timestamp("last_test_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("ai_providers_user_idx").on(table.userId),
    index("ai_providers_user_default_idx").on(table.userId, table.isDefault),
  ],
);

export const insertAiProviderSchema = createInsertSchema(aiProvidersTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  lastTestAt: true,
});
export type InsertAiProvider = z.infer<typeof insertAiProviderSchema>;
export type AiProvider = typeof aiProvidersTable.$inferSelect;

export const routerAppTokensTable = pgTable(
  "router_app_tokens",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    name: text("name").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    tokenPreview: text("token_preview").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  },
  (table) => [index("router_app_tokens_user_idx").on(table.userId)],
);

export const routerTokensTable = pgTable(
  "router_tokens",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    tokenPreview: text("token_preview").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex("router_tokens_user_unique").on(table.userId)],
);

export const routerRequestMetricsTable = pgTable(
  "router_request_metrics",
  {
    id: serial("id").primaryKey(),
    requestId: uuid("request_id").notNull(),
    userId: text("user_id").notNull(),
    providerId: uuid("provider_id"),
    providerName: text("provider_name").notNull(),
    tokenId: integer("token_id"),
    applicationName: text("application_name").notNull(),
    source: text("source").notNull(),
    taskType: text("task_type").notNull(),
    attemptNumber: integer("attempt_number").notNull(),
    attemptCount: integer("attempt_count").notNull(),
    model: text("model").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    latencyMs: integer("latency_ms").notNull(),
    success: boolean("success").notNull(),
    errorCode: integer("error_code"),
    errorType: text("error_type"),
    promptTokens: integer("prompt_tokens"),
    completionTokens: integer("completion_tokens"),
  },
  (table) => [
    index("router_request_metrics_user_created_idx").on(
      table.userId,
      table.createdAt,
    ),
    index("router_request_metrics_provider_created_idx").on(
      table.providerId,
      table.createdAt,
    ),
    index("router_request_metrics_request_idx").on(table.requestId),
  ],
);

export const routerOwnerTable = pgTable("router_owner", {
  id: text("id").notNull().default("owner").primaryKey(),
  userId: text("user_id").notNull().unique(),
  claimedAt: timestamp("claimed_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const insertRouterOwnerSchema = createInsertSchema(routerOwnerTable).omit({
  id: true,
  claimedAt: true,
});
export type InsertRouterOwner = z.infer<typeof insertRouterOwnerSchema>;
export type RouterOwner = typeof routerOwnerTable.$inferSelect;

export const insertRouterTokenSchema = createInsertSchema(routerTokensTable).omit({
  id: true,
  createdAt: true,
});
export type InsertRouterToken = z.infer<typeof insertRouterTokenSchema>;
export type RouterToken = typeof routerTokensTable.$inferSelect;

export const insertRouterAppTokenSchema = createInsertSchema(
  routerAppTokensTable,
).omit({
  id: true,
  createdAt: true,
  lastUsedAt: true,
});
export type InsertRouterAppToken = z.infer<typeof insertRouterAppTokenSchema>;
export type RouterAppToken = typeof routerAppTokensTable.$inferSelect;

export type RouterRequestMetric = typeof routerRequestMetricsTable.$inferSelect;