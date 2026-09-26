import {
  ProviderRequestError,
  type ChatMessage,
  type NormalizedChatResult,
} from "./ai-router";
import type { ProviderCapability, RouterTaskType } from "@workspace/db";

export type RouteProvider = {
  id: string;
  name: string;
  model: string;
  capabilities: ProviderCapability[];
  priority: number;
  isActive: boolean;
  isDefault: boolean;
  healthStatus: string;
  cooldownUntil: Date | null;
};

export type RecentProviderStats = {
  successRate: number;
  averageLatencyMs: number | null;
};

export type RouteRequest = {
  taskType?: RouterTaskType;
  providerId?: string | null;
  model?: string | null;
};

export type RouteCandidate = {
  provider: RouteProvider;
  model: string;
};

export type RouteAttempt = {
  candidate: RouteCandidate;
  startedAt: Date;
  latencyMs: number;
  success: boolean;
  result?: NormalizedChatResult;
  error?: unknown;
  errorCode: number | null;
  errorType: string | null;
};

export type RouteMetricContext = {
  requestId: string;
  userId: string;
  tokenId?: number | null;
  applicationName: string;
  source: "app" | "playground";
  taskType: RouterTaskType;
};

export class RouteSelectionError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = "RouteSelectionError";
  }
}

export class RouteExecutionError extends Error {
  constructor(
    message: string,
    public readonly attempts: RouteAttempt[],
    public readonly lastError: unknown,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = "RouteExecutionError";
  }
}

function isInCooldown(provider: RouteProvider, now: Date): boolean {
  return (
    provider.healthStatus === "unavailable" &&
    provider.cooldownUntil !== null &&
    provider.cooldownUntil.getTime() > now.getTime()
  );
}

function healthRank(provider: RouteProvider, now: Date): number {
  if (provider.healthStatus === "available") return 2;
  if (provider.healthStatus === "degraded") return 1;
  if (
    provider.healthStatus === "unavailable" &&
    !isInCooldown(provider, now)
  ) {
    return 1;
  }
  return 0;
}

function comparePriority(
  first: RouteProvider,
  second: RouteProvider,
  stats: Map<string, RecentProviderStats>,
  now: Date,
  explicitProviderId?: string,
  requestedModel?: string,
  preferDefault = false,
): number {
  if (explicitProviderId) {
    const firstExplicit = first.id === explicitProviderId;
    const secondExplicit = second.id === explicitProviderId;
    if (firstExplicit !== secondExplicit) return firstExplicit ? -1 : 1;
  }

  if (requestedModel) {
    const firstMatch = first.model === requestedModel;
    const secondMatch = second.model === requestedModel;
    if (firstMatch !== secondMatch) return firstMatch ? -1 : 1;
  }

  const healthDifference = healthRank(second, now) - healthRank(first, now);
  if (healthDifference !== 0) return healthDifference;

  if (first.priority !== second.priority) {
    return second.priority - first.priority;
  }

  const firstStats = stats.get(first.id);
  const secondStats = stats.get(second.id);
  const successDifference =
    (secondStats?.successRate ?? 0.5) -
    (firstStats?.successRate ?? 0.5);
  if (successDifference !== 0) return successDifference;

  const firstLatency = firstStats?.averageLatencyMs ?? Number.POSITIVE_INFINITY;
  const secondLatency =
    secondStats?.averageLatencyMs ?? Number.POSITIVE_INFINITY;
  if (firstLatency !== secondLatency) return firstLatency - secondLatency;

  if (preferDefault && first.isDefault !== second.isDefault) {
    return first.isDefault ? -1 : 1;
  }
  return first.name.localeCompare(second.name);
}

export function selectRoute(
  request: RouteRequest,
  providers: RouteProvider[],
  recentStats: Map<string, RecentProviderStats> = new Map(),
  now = new Date(),
): RouteCandidate[] {
  const taskType = request.taskType ?? "chat";
  const requestedModel = request.model?.trim() || undefined;
  const explicitProviderId = request.providerId || undefined;

  if (explicitProviderId) {
    const explicitProvider = providers.find(
      (provider) => provider.id === explicitProviderId,
    );
    if (!explicitProvider) {
      throw new RouteSelectionError("The requested provider is not configured.", 400);
    }
    if (!explicitProvider.isActive) {
      throw new RouteSelectionError("The requested provider is inactive.", 400);
    }
    if (!explicitProvider.capabilities.includes(taskType)) {
      throw new RouteSelectionError(
        `The requested provider is not configured for task type "${taskType}".`,
        400,
      );
    }
  }

  const compatibleProviders = providers.filter(
    (provider) =>
      provider.isActive &&
      provider.capabilities.includes(taskType) &&
      !isInCooldown(provider, now),
  );
  if (compatibleProviders.length === 0) {
    if (providers.length === 0) {
      throw new RouteSelectionError(
        "Add a provider before sending a chat request.",
        400,
      );
    }
    const hasActiveProvider = providers.some((provider) => provider.isActive);
    throw new RouteSelectionError(
      hasActiveProvider
        ? `No available provider is configured for task type "${taskType}".`
        : "There are no active providers available for routing.",
      hasActiveProvider ? 400 : 503,
    );
  }

  const hasConfiguredModel = Boolean(
    requestedModel &&
      compatibleProviders.some((provider) => provider.model === requestedModel),
  );
  const preferDefault = Boolean(requestedModel && !hasConfiguredModel);
  const sortedProviders = [...compatibleProviders].sort((first, second) =>
    comparePriority(
      first,
      second,
      recentStats,
      now,
      explicitProviderId,
      hasConfiguredModel ? requestedModel : undefined,
      preferDefault,
    ),
  );

  return sortedProviders.map((provider, index) => ({
    provider,
    model:
      requestedModel &&
      (provider.model === requestedModel || (!hasConfiguredModel && index === 0))
        ? requestedModel
        : provider.model,
  }));
}

export function classifyProviderFailure(error: unknown): {
  retryable: boolean;
  errorCode: number | null;
  errorType: string;
} {
  if (error instanceof ProviderRequestError) {
    const statusCode = error.statusCode;
    const timeout = statusCode === 408 || statusCode === 504;
    return {
      retryable: timeout || statusCode === 429 || statusCode >= 500,
      errorCode: statusCode,
      errorType: timeout
        ? "timeout"
        : statusCode === 429
          ? "rate_limit"
          : statusCode >= 500
            ? "provider_unavailable"
            : "provider_error",
    };
  }

  if (
    error instanceof Error &&
    /timeout|timed out|abort|network|fetch failed/i.test(
      `${error.name} ${error.message}`,
    )
  ) {
    return {
      retryable: true,
      errorCode: 502,
      errorType: "provider_unavailable",
    };
  }

  return { retryable: false, errorCode: null, errorType: "provider_error" };
}

export async function executeRoutedChat(
  input: {
    request: RouteRequest;
    providers: RouteProvider[];
    recentStats?: Map<string, RecentProviderStats>;
    messages: ChatMessage[];
    options?: { temperature?: number; maxTokens?: number };
    maxAttempts?: number;
    execute: (
      candidate: RouteCandidate,
      messages: ChatMessage[],
      options?: { temperature?: number; maxTokens?: number },
    ) => Promise<NormalizedChatResult>;
    onAttempt?: (attempt: RouteAttempt) => Promise<void>;
  },
): Promise<{
  candidate: RouteCandidate;
  result: NormalizedChatResult;
  attempts: RouteAttempt[];
}> {
  const candidates = selectRoute(
    input.request,
    input.providers,
    input.recentStats,
  );
  const maxAttempts = Math.min(3, Math.max(1, input.maxAttempts ?? 3));
  const attempts: RouteAttempt[] = [];

  for (const candidate of candidates.slice(0, maxAttempts)) {
    const startedAt = new Date();
    const start = Date.now();
    try {
      const result = await input.execute(
        candidate,
        input.messages,
        input.options,
      );
      const attempt: RouteAttempt = {
        candidate,
        startedAt,
        latencyMs: Math.max(0, Date.now() - start),
        success: true,
        result,
        errorCode: null,
        errorType: null,
      };
      attempts.push(attempt);
      await input.onAttempt?.(attempt);
      return { candidate, result, attempts };
    } catch (error) {
      const failure = classifyProviderFailure(error);
      const attempt: RouteAttempt = {
        candidate,
        startedAt,
        latencyMs: Math.max(0, Date.now() - start),
        success: false,
        error,
        errorCode: failure.errorCode,
        errorType: failure.errorType,
      };
      attempts.push(attempt);
      await input.onAttempt?.(attempt);

      const reachedLimit = attempts.length >= maxAttempts;
      const noMoreCandidates = attempts.length >= candidates.length;
      if (!failure.retryable || reachedLimit || noMoreCandidates) {
        const lastMessage =
          error instanceof Error ? error.message.slice(0, 260) : "Unknown provider error.";
        throw new RouteExecutionError(
          `No provider responded successfully after ${attempts.length} attempt${attempts.length === 1 ? "" : "s"}. Last error: ${lastMessage}`,
          attempts,
          error,
          error instanceof ProviderRequestError ? error.statusCode : 502,
        );
      }
    }
  }

  throw new RouteExecutionError(
    "No compatible provider could be selected.",
    attempts,
    null,
    503,
  );
}

export function buildAttemptMetricRows(
  context: RouteMetricContext,
  attempts: RouteAttempt[],
) {
  return attempts.map((attempt, index) => ({
    requestId: context.requestId,
    userId: context.userId,
    providerId: attempt.candidate.provider.id,
    providerName: attempt.candidate.provider.name,
    tokenId: context.tokenId ?? null,
    applicationName: context.applicationName,
    source: context.source,
    taskType: context.taskType,
    attemptNumber: index + 1,
    attemptCount: attempts.length,
    model: attempt.result?.model ?? attempt.candidate.model,
    createdAt: attempt.startedAt,
    latencyMs: attempt.latencyMs,
    success: attempt.success,
    errorCode: attempt.errorCode,
    errorType: attempt.errorType,
    promptTokens: attempt.result?.promptTokens ?? null,
    completionTokens: attempt.result?.completionTokens ?? null,
  }));
}