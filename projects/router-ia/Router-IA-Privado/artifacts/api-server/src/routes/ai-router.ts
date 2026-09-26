import { getAuth } from "@clerk/express";
import { randomUUID } from "node:crypto";
import {
  and,
  asc,
  avg,
  count,
  countDistinct,
  desc,
  eq,
  gte,
  gt,
  max,
  ne,
  sql,
  type InferInsertModel,
} from "drizzle-orm";
import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  aiProvidersTable,
  routerAppTokensTable,
  routerOwnerTable,
  routerRequestMetricsTable,
  routerTokensTable,
  type RouterTaskType,
} from "@workspace/db";
import {
  CreateRouterAppTokenBody,
  CreateRouterAppTokenResponse,
  CreateChatCompletionBody,
  CreateChatCompletionResponse,
  CreateProviderBody,
  CreateProviderResponse,
  CreateRouterTokenResponse,
  DeleteProviderParams,
  GetRouterStatusResponse,
  GetRouterSummaryResponse,
  GetRouterTokenStatusResponse,
  ListRouterAppTokensResponse,
  ListProvidersResponse,
  RevokeRouterAppTokenParams,
  RevokeRouterAppTokenResponse,
  RevokeRouterTokenResponse,
  SendRouterChatBody,
  SendRouterChatResponse,
  TestProviderParams,
  TestProviderResponse,
  UpdateProviderBody,
  UpdateProviderParams,
  UpdateProviderResponse,
} from "@workspace/api-zod";
import {
  createOpenAIChatCompletion,
  decryptApiKey,
  encryptApiKey,
  hashRouterToken,
  issueRouterToken,
  normalizeCustomBaseUrl,
  ProviderRequestError,
  runProviderChat,
  type ChatMessage,
  type ProviderKind,
} from "../lib/ai-router";
import {
  buildAttemptMetricRows,
  executeRoutedChat,
  RouteExecutionError,
  RouteSelectionError,
  type RecentProviderStats,
  type RouteAttempt,
  type RouteProvider,
} from "../lib/intelligent-router";

const router: IRouter = Router();
type ProviderRow = typeof aiProvidersTable.$inferSelect;
type ProviderInsert = InferInsertModel<typeof aiProvidersTable>;

function currentUserId(req: Request): string | null {
  return getAuth(req).userId ?? null;
}

async function requireClerkUser(
  req: Request,
  res: Response,
): Promise<string | null> {
  const userId = currentUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Sign in to use Router IA." });
    return null;
  }

  await db
    .insert(routerOwnerTable)
    .values({ userId })
    .onConflictDoNothing({ target: routerOwnerTable.id });
  const [owner] = await db.select().from(routerOwnerTable).limit(1);
  if (!owner || owner.userId !== userId) {
    res.status(403).json({
      error: "Este Router IA está reservado para la cuenta propietaria.",
    });
    return null;
  }
  return userId;
}

function toPublicProvider(provider: ProviderRow) {
  return {
    id: provider.id,
    name: provider.name,
    kind: provider.kind,
    baseUrl: provider.baseUrl,
    model: provider.model,
    apiKeyPreview: provider.apiKeyPreview,
    isDefault: provider.isDefault,
    capabilities: provider.capabilities,
    priority: provider.priority,
    isActive: provider.isActive,
    status: provider.status,
    healthStatus: provider.healthStatus,
    consecutiveFailures: provider.consecutiveFailures,
    cooldownUntil: provider.cooldownUntil?.toISOString() ?? null,
    lastTestAt: provider.lastTestAt?.toISOString() ?? null,
    createdAt: provider.createdAt.toISOString(),
    updatedAt: provider.updatedAt.toISOString(),
  };
}

function toProviderConfig(provider: ProviderRow) {
  return {
    kind: provider.kind as ProviderKind,
    baseUrl: provider.baseUrl,
    model: provider.model,
    apiKey: decryptApiKey(provider),
  };
}

function toRouteProvider(provider: ProviderRow): RouteProvider {
  return {
    id: provider.id,
    name: provider.name,
    model: provider.model,
    capabilities: provider.capabilities,
    priority: provider.priority,
    isActive: provider.isActive,
    isDefault: provider.isDefault,
    healthStatus: provider.healthStatus,
    cooldownUntil: provider.cooldownUntil,
  };
}

function safeProviderError(error: unknown): string {
  if (error instanceof ProviderRequestError) {
    return error.message;
  }
  return error instanceof Error ? error.message.slice(0, 260) : "Unexpected error.";
}

function routeErrorStatus(error: unknown): number {
  if (
    error instanceof ProviderRequestError ||
    error instanceof RouteSelectionError ||
    error instanceof RouteExecutionError
  ) {
    return error.statusCode;
  }
  return 500;
}

async function findProvider(userId: string, id: string): Promise<ProviderRow | null> {
  const [provider] = await db
    .select()
    .from(aiProvidersTable)
    .where(and(eq(aiProvidersTable.userId, userId), eq(aiProvidersTable.id, id)))
    .limit(1);
  return provider ?? null;
}

function tokenPreview(token: string): string {
  return `${token.slice(0, 13)}••••${token.slice(-4)}`;
}

async function getRecentProviderStats(
  userId: string,
): Promise<Map<string, RecentProviderStats>> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const rows = await db
    .select({
      providerId: routerRequestMetricsTable.providerId,
      success: routerRequestMetricsTable.success,
      latencyMs: routerRequestMetricsTable.latencyMs,
    })
    .from(routerRequestMetricsTable)
    .where(
      and(
        eq(routerRequestMetricsTable.userId, userId),
        gte(routerRequestMetricsTable.createdAt, since),
      ),
    )
    .orderBy(desc(routerRequestMetricsTable.createdAt))
    .limit(1000);

  const grouped = new Map<
    string,
    { attempts: number; successes: number; latencyTotal: number }
  >();
  for (const row of rows) {
    if (!row.providerId) continue;
    const current = grouped.get(row.providerId) ?? {
      attempts: 0,
      successes: 0,
      latencyTotal: 0,
    };
    current.attempts += 1;
    if (row.success) current.successes += 1;
    current.latencyTotal += row.latencyMs;
    grouped.set(row.providerId, current);
  }

  return new Map(
    [...grouped].map(([providerId, stats]) => [
      providerId,
      {
        successRate: stats.successes / stats.attempts,
        averageLatencyMs: Math.round(stats.latencyTotal / stats.attempts),
      },
    ]),
  );
}

async function updateProviderHealth(
  userId: string,
  providerId: string,
  success: boolean,
): Promise<void> {
  const where = and(
    eq(aiProvidersTable.userId, userId),
    eq(aiProvidersTable.id, providerId),
  );
  if (success) {
    await db
      .update(aiProvidersTable)
      .set({
        healthStatus: "available",
        consecutiveFailures: 0,
        cooldownUntil: null,
        updatedAt: new Date(),
      })
      .where(where);
    return;
  }

  const nextFailureCount = sql`${aiProvidersTable.consecutiveFailures} + 1`;
  await db
    .update(aiProvidersTable)
    .set({
      consecutiveFailures: nextFailureCount,
      healthStatus: sql`case when ${nextFailureCount} >= 2 then 'unavailable' else 'degraded' end`,
      cooldownUntil: sql`case when ${nextFailureCount} >= 2 then now() + interval '60 seconds' else null end`,
      updatedAt: new Date(),
    })
    .where(where);
}

async function persistRequestMetrics(
  log: Request["log"],
  context: Parameters<typeof buildAttemptMetricRows>[0],
  attempts: RouteAttempt[],
): Promise<void> {
  if (attempts.length === 0) return;
  try {
    await db
      .insert(routerRequestMetricsTable)
      .values(buildAttemptMetricRows(context, attempts));
  } catch (error) {
    log.error({ err: error, requestId: context.requestId }, "Could not persist router request metrics");
  }
}

async function runChatForUser(
  userId: string,
  messages: ChatMessage[],
  options: {
    providerId?: string | null;
    taskType?: RouterTaskType;
    temperature?: number;
    maxTokens?: number;
    model?: string;
  },
  context: {
    tokenId?: number | null;
    applicationName: string;
    source: "app" | "playground";
  },
  log: Request["log"],
): Promise<{
  content: string;
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
}> {
  const providers = await db
    .select()
    .from(aiProvidersTable)
    .where(eq(aiProvidersTable.userId, userId))
    .orderBy(desc(aiProvidersTable.updatedAt));
  const recentStats = await getRecentProviderStats(userId);
  const requestId = randomUUID();
  const taskType = options.taskType ?? "chat";
  let attempts: RouteAttempt[] = [];

  try {
    const routed = await executeRoutedChat({
      request: {
        providerId: options.providerId,
        model: options.model,
        taskType,
      },
      providers: providers.map(toRouteProvider),
      recentStats,
      messages,
      options: {
        temperature: options.temperature,
        maxTokens: options.maxTokens,
      },
      execute: (candidate, chatMessages, chatOptions) => {
        const provider = providers.find(
          (item) => item.id === candidate.provider.id,
        );
        if (!provider) {
          throw new ProviderRequestError("The selected provider no longer exists.", 503);
        }
        return runProviderChat(toProviderConfig(provider), chatMessages, {
          ...chatOptions,
          model: candidate.model,
        });
      },
      onAttempt: async (attempt) => {
        try {
          await updateProviderHealth(
            userId,
            attempt.candidate.provider.id,
            attempt.success,
          );
        } catch (error) {
          log.error(
            { err: error, providerId: attempt.candidate.provider.id },
            "Could not update provider health",
          );
        }
      },
    });
    attempts = routed.attempts;
    return {
      content: routed.result.content,
      provider: routed.candidate.provider.name,
      model: routed.result.model,
      promptTokens: routed.result.promptTokens,
      completionTokens: routed.result.completionTokens,
    };
  } catch (error) {
    if (error instanceof RouteExecutionError) {
      attempts = error.attempts;
    }
    throw error;
  } finally {
    await persistRequestMetrics(
      log,
      {
        requestId,
        userId,
        tokenId: context.tokenId,
        applicationName: context.applicationName,
        source: context.source,
        taskType,
      },
      attempts,
    );
  }
}

router.get("/providers", async (req, res): Promise<void> => {
  const userId = await requireClerkUser(req, res);
  if (!userId) return;

  const providers = await db
    .select()
    .from(aiProvidersTable)
    .where(eq(aiProvidersTable.userId, userId))
    .orderBy(desc(aiProvidersTable.updatedAt));
  res.setHeader("Cache-Control", "no-store");
  res.json(ListProvidersResponse.parse(providers.map(toPublicProvider)));
});

router.post("/providers", async (req, res): Promise<void> => {
  const userId = await requireClerkUser(req, res);
  if (!userId) return;

  const parsed = CreateProviderBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  let baseUrl: string | null = null;
  if (parsed.data.kind === "openai-compatible") {
    try {
      if (!parsed.data.baseUrl) {
        res.status(400).json({ error: "Enter an HTTPS API address." });
        return;
      }
      baseUrl = normalizeCustomBaseUrl(parsed.data.baseUrl);
    } catch (error) {
      res.status(400).json({ error: safeProviderError(error) });
      return;
    }
  }

  const [existing] = await db
    .select({ id: aiProvidersTable.id })
    .from(aiProvidersTable)
    .where(eq(aiProvidersTable.userId, userId))
    .limit(1);
  const isActive = parsed.data.isActive ?? true;
  if (parsed.data.isDefault && !isActive) {
    res.status(400).json({ error: "An inactive provider cannot be the default route." });
    return;
  }
  const makeDefault = isActive && (parsed.data.isDefault || !existing);
  const encrypted = encryptApiKey(parsed.data.apiKey);

  const created = await db.transaction(async (tx) => {
    if (makeDefault) {
      await tx
        .update(aiProvidersTable)
        .set({ isDefault: false })
        .where(eq(aiProvidersTable.userId, userId));
    }
    const [provider] = await tx
      .insert(aiProvidersTable)
      .values({
        userId,
        name: parsed.data.name.trim(),
        kind: parsed.data.kind,
        baseUrl,
        model: parsed.data.model.trim(),
        ...encrypted,
        isDefault: makeDefault,
        capabilities: parsed.data.capabilities ?? ["chat"],
        priority: parsed.data.priority ?? 50,
        isActive,
      })
      .returning();
    return provider;
  });

  if (!created) {
    res.status(500).json({ error: "The provider could not be saved." });
    return;
  }
  res.setHeader("Cache-Control", "no-store");
  res.status(201).json(CreateProviderResponse.parse(toPublicProvider(created)));
});

router.patch("/providers/:id", async (req, res): Promise<void> => {
  const userId = await requireClerkUser(req, res);
  if (!userId) return;

  const params = UpdateProviderParams.safeParse(req.params);
  const parsed = UpdateProviderBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({
      error: params.success
        ? (parsed.error?.message ?? "Invalid provider changes.")
        : (params.error?.message ?? "Invalid provider ID."),
    });
    return;
  }

  const provider = await findProvider(userId, params.data.id);
  if (!provider) {
    res.status(404).json({ error: "Provider not found." });
    return;
  }
  if (Object.keys(parsed.data).length === 0) {
    res.status(400).json({ error: "No provider changes were supplied." });
    return;
  }

  const patch: Partial<ProviderInsert> = { updatedAt: new Date() };
  if (parsed.data.name !== undefined) patch.name = parsed.data.name.trim();
  if (parsed.data.model !== undefined) patch.model = parsed.data.model.trim();
  if (parsed.data.capabilities !== undefined) {
    patch.capabilities = parsed.data.capabilities;
  }
  if (parsed.data.priority !== undefined) patch.priority = parsed.data.priority;
  if (parsed.data.isActive !== undefined) patch.isActive = parsed.data.isActive;
  if (parsed.data.apiKey !== undefined) {
    Object.assign(patch, encryptApiKey(parsed.data.apiKey));
    patch.status = "untested";
    patch.lastTestAt = null;
  }
  if (provider.kind === "openai-compatible" && parsed.data.baseUrl !== undefined) {
    try {
      patch.baseUrl = parsed.data.baseUrl
        ? normalizeCustomBaseUrl(parsed.data.baseUrl)
        : null;
      if (!patch.baseUrl) {
        res.status(400).json({ error: "Enter an HTTPS API address." });
        return;
      }
    } catch (error) {
      res.status(400).json({ error: safeProviderError(error) });
      return;
    }
  }

  const updated = await db.transaction(async (tx) => {
    if (parsed.data.isDefault) {
      patch.isActive = true;
      await tx
        .update(aiProvidersTable)
        .set({ isDefault: false })
        .where(eq(aiProvidersTable.userId, userId));
      patch.isDefault = true;
    } else if (
      (parsed.data.isDefault === false || parsed.data.isActive === false) &&
      provider.isDefault
    ) {
      patch.isDefault = false;
    }

    const [row] = await tx
      .update(aiProvidersTable)
      .set(patch)
      .where(
        and(
          eq(aiProvidersTable.userId, userId),
          eq(aiProvidersTable.id, params.data.id),
        ),
      )
      .returning();

    if (
      (parsed.data.isDefault === false || parsed.data.isActive === false) &&
      provider.isDefault
    ) {
      const [fallback] = await tx
        .select({ id: aiProvidersTable.id })
        .from(aiProvidersTable)
        .where(
          and(
            eq(aiProvidersTable.userId, userId),
            ne(aiProvidersTable.id, params.data.id),
            eq(aiProvidersTable.isActive, true),
          ),
        )
        .orderBy(asc(aiProvidersTable.createdAt))
        .limit(1);
      if (fallback) {
        await tx
          .update(aiProvidersTable)
          .set({ isDefault: true })
          .where(eq(aiProvidersTable.id, fallback.id));
      } else if (parsed.data.isActive !== false) {
        await tx
          .update(aiProvidersTable)
          .set({ isDefault: true })
          .where(eq(aiProvidersTable.id, params.data.id));
      }
    }
    return row;
  });

  res.setHeader("Cache-Control", "no-store");
  res.json(UpdateProviderResponse.parse(toPublicProvider(updated)));
});

router.delete("/providers/:id", async (req, res): Promise<void> => {
  const userId = await requireClerkUser(req, res);
  if (!userId) return;
  const params = DeleteProviderParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const deleted = await db.transaction(async (tx) => {
    const [provider] = await tx
      .delete(aiProvidersTable)
      .where(
        and(
          eq(aiProvidersTable.userId, userId),
          eq(aiProvidersTable.id, params.data.id),
        ),
      )
      .returning();

    if (provider?.isDefault) {
      const [fallback] = await tx
        .select({ id: aiProvidersTable.id })
        .from(aiProvidersTable)
        .where(
          and(
            eq(aiProvidersTable.userId, userId),
            eq(aiProvidersTable.isActive, true),
          ),
        )
        .orderBy(asc(aiProvidersTable.createdAt))
        .limit(1);
      if (fallback) {
        await tx
          .update(aiProvidersTable)
          .set({ isDefault: true })
          .where(eq(aiProvidersTable.id, fallback.id));
      }
    }
    return provider;
  });

  if (!deleted) {
    res.status(404).json({ error: "Provider not found." });
    return;
  }
  res.status(204).send();
});

router.post("/providers/:id/test", async (req, res): Promise<void> => {
  const userId = await requireClerkUser(req, res);
  if (!userId) return;
  const params = TestProviderParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const provider = await findProvider(userId, params.data.id);
  if (!provider) {
    res.status(404).json({ error: "Provider not found." });
    return;
  }

  const startedAt = Date.now();
  let result: { success: boolean; message: string; model: string; latencyMs: number };
  try {
    await runProviderChat(
      toProviderConfig(provider),
      [{ role: "user", content: "Reply with OK." }],
      { maxTokens: 8 },
    );
    result = {
      success: true,
      message: "Connection is working.",
      model: provider.model,
      latencyMs: Date.now() - startedAt,
    };
  } catch (error) {
    result = {
      success: false,
      message: safeProviderError(error),
      model: provider.model,
      latencyMs: Date.now() - startedAt,
    };
    req.log.warn(
      { providerId: provider.id, message: result.message },
      "Provider connection test failed",
    );
  }

  try {
    await updateProviderHealth(userId, provider.id, result.success);
  } catch (error) {
    req.log.error(
      { err: error, providerId: provider.id },
      "Could not update provider health after connection test",
    );
  }

  const [updated] = await db
    .update(aiProvidersTable)
    .set({
      status: result.success ? "connected" : "error",
      lastTestAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(aiProvidersTable.userId, userId),
        eq(aiProvidersTable.id, provider.id),
      ),
    )
    .returning();

  res.setHeader("Cache-Control", "no-store");
  res.json(
    TestProviderResponse.parse({
      ...result,
      model: updated?.model ?? provider.model,
    }),
  );
});

router.get("/router/summary", async (req, res): Promise<void> => {
  const userId = await requireClerkUser(req, res);
  if (!userId) return;

  const providers = await db
    .select()
    .from(aiProvidersTable)
    .where(eq(aiProvidersTable.userId, userId))
    .orderBy(desc(aiProvidersTable.updatedAt));
  const [token] = await db
    .select({ id: routerTokensTable.id })
    .from(routerTokensTable)
    .where(eq(routerTokensTable.userId, userId))
    .limit(1);
  const defaultProvider =
    providers.find((provider) => provider.isDefault) ?? providers[0] ?? null;

  res.setHeader("Cache-Control", "no-store");
  res.json(
    GetRouterSummaryResponse.parse({
      providerCount: providers.length,
      defaultProvider: defaultProvider
        ? toPublicProvider(defaultProvider)
        : null,
      hasToken: Boolean(token),
    }),
  );
});

router.post("/router/chat", async (req, res): Promise<void> => {
  const userId = await requireClerkUser(req, res);
  if (!userId) return;
  const parsed = SendRouterChatBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  try {
    const result = await runChatForUser(
      userId,
      parsed.data.messages as ChatMessage[],
      {
        providerId: parsed.data.providerId,
        taskType: parsed.data.taskType,
        temperature: parsed.data.temperature,
        maxTokens: parsed.data.maxTokens,
      },
      {
        applicationName: "playground",
        source: "playground",
      },
      req.log,
    );
    res.json(SendRouterChatResponse.parse(result));
  } catch (error) {
    res.status(routeErrorStatus(error)).json({ error: safeProviderError(error) });
  }
});

router.get("/router/status", async (req, res): Promise<void> => {
  const userId = await requireClerkUser(req, res);
  if (!userId) return;

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const providers = await db
    .select()
    .from(aiProvidersTable)
    .where(eq(aiProvidersTable.userId, userId))
    .orderBy(desc(aiProvidersTable.priority), asc(aiProvidersTable.name));
  const [totals] = await db
    .select({
      requests24h: countDistinct(routerRequestMetricsTable.requestId),
      fallbacks24h: countDistinct(
        sql`case when ${routerRequestMetricsTable.attemptCount} > 1 then ${routerRequestMetricsTable.requestId} end`,
      ),
      averageLatencyMs: avg(routerRequestMetricsTable.latencyMs),
      successRatePercent: sql<number | null>`round(
        count(*) filter (where ${routerRequestMetricsTable.success}) * 100.0 /
        nullif(count(*), 0),
        1
      )`,
    })
    .from(routerRequestMetricsTable)
    .where(
      and(
        eq(routerRequestMetricsTable.userId, userId),
        gte(routerRequestMetricsTable.createdAt, since),
      ),
    );
  const providerMetrics = await db
    .select({
      providerId: routerRequestMetricsTable.providerId,
      requestCount: countDistinct(routerRequestMetricsTable.requestId),
      averageLatencyMs: avg(routerRequestMetricsTable.latencyMs),
      successRatePercent: sql<number | null>`round(
        count(*) filter (where ${routerRequestMetricsTable.success}) * 100.0 /
        nullif(count(*), 0),
        1
      )`,
      lastUsedAt: max(routerRequestMetricsTable.createdAt),
    })
    .from(routerRequestMetricsTable)
    .where(
      and(
        eq(routerRequestMetricsTable.userId, userId),
        gte(routerRequestMetricsTable.createdAt, since),
      ),
    )
    .groupBy(routerRequestMetricsTable.providerId);
  const [latestMetric] = await db
    .select({
      providerName: routerRequestMetricsTable.providerName,
      model: routerRequestMetricsTable.model,
      applicationName: routerRequestMetricsTable.applicationName,
      createdAt: routerRequestMetricsTable.createdAt,
      success: routerRequestMetricsTable.success,
      attemptCount: routerRequestMetricsTable.attemptCount,
    })
    .from(routerRequestMetricsTable)
    .where(eq(routerRequestMetricsTable.userId, userId))
    .orderBy(
      desc(routerRequestMetricsTable.createdAt),
      desc(routerRequestMetricsTable.attemptNumber),
    )
    .limit(1);

  const statsByProvider = new Map(
    providerMetrics
      .filter(
        (
          metric,
        ): metric is typeof metric & { providerId: string } =>
          metric.providerId !== null,
      )
      .map((metric) => [metric.providerId, metric]),
  );
  const toNullableNumber = (value: number | string | null): number | null => {
    if (value === null) return null;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.round(numeric) : null;
  };
  const now = new Date();
  const activeProviders = providers.filter((provider) => provider.isActive);
  const availableProviderCount = activeProviders.filter(
    (provider) =>
      provider.healthStatus !== "unavailable" ||
      !provider.cooldownUntil ||
      provider.cooldownUntil <= now,
  ).length;
  const successRatePercent = toNullableNumber(
    totals?.successRatePercent ?? null,
  );
  let status: "available" | "degraded" | "unavailable" | "not_configured";
  if (providers.length === 0) {
    status = "not_configured";
  } else if (activeProviders.length === 0 || availableProviderCount === 0) {
    status = "unavailable";
  } else if (
    availableProviderCount < activeProviders.length ||
    (successRatePercent !== null && successRatePercent < 95)
  ) {
    status = "degraded";
  } else {
    status = "available";
  }

  res.setHeader("Cache-Control", "no-store");
  res.json(
    GetRouterStatusResponse.parse({
      status,
      providerCount: providers.length,
      availableProviderCount,
      requests24h: totals?.requests24h ?? 0,
      fallbacks24h: totals?.fallbacks24h ?? 0,
      averageLatencyMs: toNullableNumber(totals?.averageLatencyMs ?? null),
      successRatePercent,
      recentExecution: latestMetric
        ? {
            provider: latestMetric.providerName,
            model: latestMetric.model,
            applicationName: latestMetric.applicationName,
            createdAt: latestMetric.createdAt.toISOString(),
            success: latestMetric.success,
            attemptCount: latestMetric.attemptCount,
          }
        : null,
      providers: providers.map((provider) => {
        const metric = statsByProvider.get(provider.id);
        return {
          providerId: provider.id,
          name: provider.name,
          model: provider.model,
          isActive: provider.isActive,
          healthStatus: provider.healthStatus,
          requestCount: metric?.requestCount ?? 0,
          averageLatencyMs: toNullableNumber(
            metric?.averageLatencyMs ?? null,
          ),
          successRatePercent: toNullableNumber(
            metric?.successRatePercent ?? null,
          ),
          lastUsedAt: metric?.lastUsedAt?.toISOString() ?? null,
        };
      }),
    }),
  );
});

router.get("/router/token", async (req, res): Promise<void> => {
  const userId = await requireClerkUser(req, res);
  if (!userId) return;
  const [token] = await db
    .select()
    .from(routerTokensTable)
    .where(eq(routerTokensTable.userId, userId))
    .limit(1);

  res.setHeader("Cache-Control", "no-store");
  res.json(
    GetRouterTokenStatusResponse.parse({
      active: Boolean(token),
      preview: token?.tokenPreview ?? null,
      createdAt: token?.createdAt.toISOString() ?? null,
    }),
  );
});

router.post("/router/token", async (req, res): Promise<void> => {
  const userId = await requireClerkUser(req, res);
  if (!userId) return;
  const token = issueRouterToken();

  const [issued] = await db.transaction(async (tx) => {
    await tx
      .delete(routerTokensTable)
      .where(eq(routerTokensTable.userId, userId));
    return tx
      .insert(routerTokensTable)
      .values({
        userId,
        tokenHash: hashRouterToken(token),
        tokenPreview: tokenPreview(token),
      })
      .returning();
  });

  res.setHeader("Cache-Control", "no-store");
  res.status(201).json(
    CreateRouterTokenResponse.parse({
      token,
      preview: issued.tokenPreview,
      createdAt: issued.createdAt.toISOString(),
    }),
  );
});

router.delete("/router/token", async (req, res): Promise<void> => {
  const userId = await requireClerkUser(req, res);
  if (!userId) return;
  await db
    .delete(routerTokensTable)
    .where(eq(routerTokensTable.userId, userId));
  RevokeRouterTokenResponse.parse(undefined);
  res.status(204).send();
});

router.get("/router/app-tokens", async (req, res): Promise<void> => {
  const userId = await requireClerkUser(req, res);
  if (!userId) return;
  const tokens = await db
    .select()
    .from(routerAppTokensTable)
    .where(eq(routerAppTokensTable.userId, userId))
    .orderBy(desc(routerAppTokensTable.createdAt));

  res.setHeader("Cache-Control", "no-store");
  res.json(
    ListRouterAppTokensResponse.parse(
      tokens.map((token) => ({
        id: token.id,
        name: token.name,
        preview: token.tokenPreview,
        createdAt: token.createdAt.toISOString(),
        lastUsedAt: token.lastUsedAt?.toISOString() ?? null,
      })),
    ),
  );
});

router.post("/router/app-tokens", async (req, res): Promise<void> => {
  const userId = await requireClerkUser(req, res);
  if (!userId) return;
  const parsed = CreateRouterAppTokenBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const name = parsed.data.name.trim();
  if (!name) {
    res.status(400).json({ error: "Enter a name for this application token." });
    return;
  }

  const token = issueRouterToken();
  const [issued] = await db
    .insert(routerAppTokensTable)
    .values({
      userId,
      name,
      tokenHash: hashRouterToken(token),
      tokenPreview: tokenPreview(token),
    })
    .returning();
  if (!issued) {
    res.status(500).json({ error: "The application token could not be saved." });
    return;
  }

  res.setHeader("Cache-Control", "no-store");
  res.status(201).json(
    CreateRouterAppTokenResponse.parse({
      id: issued.id,
      name: issued.name,
      token,
      preview: issued.tokenPreview,
      createdAt: issued.createdAt.toISOString(),
    }),
  );
});

router.delete("/router/app-tokens/:id", async (req, res): Promise<void> => {
  const userId = await requireClerkUser(req, res);
  if (!userId) return;
  const params = RevokeRouterAppTokenParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [deleted] = await db
    .delete(routerAppTokensTable)
    .where(
      and(
        eq(routerAppTokensTable.userId, userId),
        eq(routerAppTokensTable.id, params.data.id),
      ),
    )
    .returning({ id: routerAppTokensTable.id });
  if (!deleted) {
    res.status(404).json({ error: "Application token not found." });
    return;
  }
  RevokeRouterAppTokenResponse.parse(undefined);
  res.status(204).send();
});

router.post("/v1/chat/completions", async (req, res): Promise<void> => {
  const authorization = req.header("authorization") ?? "";
  const match = authorization.match(/^Bearer (ria_live_[A-Za-z0-9_-]+)$/);
  if (!match) {
    res.status(401).json({
      error: { message: "A valid Router IA bearer token is required." },
    });
    return;
  }

  const tokenHash = hashRouterToken(match[1]);
  const [appToken] = await db
    .select({
      id: routerAppTokensTable.id,
      userId: routerAppTokensTable.userId,
      name: routerAppTokensTable.name,
    })
    .from(routerAppTokensTable)
    .where(eq(routerAppTokensTable.tokenHash, tokenHash))
    .limit(1);
  const [personalToken] = appToken
    ? []
    : await db
    .select({ userId: routerTokensTable.userId })
    .from(routerTokensTable)
    .where(eq(routerTokensTable.tokenHash, tokenHash))
    .limit(1);
  if (!appToken && !personalToken) {
    res.status(401).json({
      error: { message: "A valid Router IA bearer token is required." },
    });
    return;
  }

  const parsed = CreateChatCompletionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { message: parsed.error.message } });
    return;
  }
  if (parsed.data.stream) {
    res.status(400).json({
      error: { message: "Streaming is not supported by this Router IA version." },
    });
    return;
  }

  if (appToken) {
    await db
      .update(routerAppTokensTable)
      .set({ lastUsedAt: new Date() })
      .where(eq(routerAppTokensTable.id, appToken.id));
  }
  const userId = appToken?.userId ?? personalToken?.userId;
  if (!userId) {
    res.status(401).json({
      error: { message: "A valid Router IA bearer token is required." },
    });
    return;
  }

  try {
    const result = await runChatForUser(
      userId,
      parsed.data.messages as ChatMessage[],
      {
        providerId: parsed.data.provider_id,
        taskType: parsed.data.task_type,
        temperature: parsed.data.temperature,
        maxTokens: parsed.data.max_tokens,
        model: parsed.data.model?.trim(),
      },
      {
        tokenId: appToken?.id ?? null,
        applicationName: appToken?.name ?? "personal-token",
        source: "app",
      },
      req.log,
    );
    res.setHeader("Cache-Control", "no-store");
    res.json(
      CreateChatCompletionResponse.parse(
        createOpenAIChatCompletion({
          content: result.content,
          model: result.model,
          promptTokens: result.promptTokens,
          completionTokens: result.completionTokens,
        }),
      ),
    );
  } catch (error) {
    const message = safeProviderError(error);
    req.log.warn({ message }, "Router provider request failed");
    res.status(routeErrorStatus(error)).json({ error: { message } });
  }
});

export default router;