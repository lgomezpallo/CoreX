import { openai } from "@workspace/integrations-openai-ai-server";
import { parseJsonObject } from "./json-output";

export type ProviderCapability = "text" | "json" | "planning" | "vision";
export type ProviderPreference = string;

type ProviderDefinition = {
  id: string;
  name: string;
  model: string;
  secretName: string;
  capabilities: ProviderCapability[];
  transport: "replit-integration" | "openai-compatible";
  integrationClient?: "openai" | "openrouter";
  integrationBaseUrlEnvName?: string;
  baseUrl?: string;
  accountIdEnvName?: string;
  tokenLimitParameter?: "max_tokens" | "max_completion_tokens";
  minimumTokenLimit?: number;
  requestTimeoutMs?: number;
  stripReasoningMarkup?: boolean;
};

type ProviderHealth = {
  reliability: number;
  successes: number;
  failures: number;
  consecutiveFailures: number;
  suspendedUntil: number | null;
  lastLatencyMs: number | null;
  lastError: string | null;
  lastTestAt: string | null;
};

type ProviderTestStatus = "passed" | "failed" | "missing-key" | "suspended";

export type ProviderTestResult = {
  providerId: string;
  name: string;
  status: ProviderTestStatus;
  latencyMs: number | null;
  reliability: number;
  testedCapabilities: ProviderCapability[];
  suspendedUntil: string | null;
  error: string | null;
};

export type ProviderChatMessages = Parameters<typeof openai.chat.completions.create>[0]["messages"];

const SUSPENSION_MS = 2 * 60_000;
const REQUEST_TIMEOUT_MS = 25_000;
const VISION_TEST_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAKklEQVR4nGN47eZGU8QwasGoBaMWjFowasGoBaMWjFowasGoBaMWDBULAHU23EwuhYLMAAAAAElFTkSuQmCC";

const providers: ProviderDefinition[] = [
  {
    id: "replit-openai",
    name: "Replit · OpenAI",
    model: "gpt-5.6-terra",
    secretName: "AI_INTEGRATIONS_OPENAI_API_KEY",
    capabilities: ["text", "json", "planning", "vision"],
    transport: "replit-integration",
    integrationClient: "openai",
    integrationBaseUrlEnvName: "AI_INTEGRATIONS_OPENAI_BASE_URL",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    model: "meta-llama/llama-3.3-70b-instruct",
    secretName: "AI_INTEGRATIONS_OPENROUTER_API_KEY",
    capabilities: ["text", "json"],
    transport: "replit-integration",
    integrationClient: "openrouter",
    integrationBaseUrlEnvName: "AI_INTEGRATIONS_OPENROUTER_BASE_URL",
    minimumTokenLimit: 8_192,
    requestTimeoutMs: 60_000,
  },
  {
    id: "groq",
    name: "Groq",
    model: "openai/gpt-oss-20b",
    secretName: "GROQ_API_KEY",
    capabilities: ["text", "json", "planning"],
    transport: "openai-compatible",
    baseUrl: "https://api.groq.com/openai/v1",
  },
  {
    id: "cloudflare-workers-ai",
    name: "Cloudflare Workers AI",
    model: "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b",
    secretName: "CLOUDFLARE_WORKERS_AI_API_TOKEN",
    capabilities: ["text", "json"],
    transport: "openai-compatible",
    baseUrl: "https://api.cloudflare.com/client/v4/accounts",
    accountIdEnvName: "CLOUDFLARE_ACCOUNT_ID",
    tokenLimitParameter: "max_tokens",
    requestTimeoutMs: 60_000,
    stripReasoningMarkup: true,
  },
];

const healthByProvider = new Map<string, ProviderHealth>();

function getHealth(providerId: string): ProviderHealth {
  let health = healthByProvider.get(providerId);
  if (!health) {
    health = {
      reliability: 50,
      successes: 0,
      failures: 0,
      consecutiveFailures: 0,
      suspendedUntil: null,
      lastLatencyMs: null,
      lastError: null,
      lastTestAt: null,
    };
    healthByProvider.set(providerId, health);
  }
  return health;
}

function findProvider(providerId: string): ProviderDefinition {
  const provider = providers.find((candidate) => candidate.id === providerId);
  if (!provider) throw new Error("Ese proveedor no está registrado.");
  return provider;
}

function getOpenAICompatibleBaseUrl(provider: ProviderDefinition): string | null {
  if (!provider.baseUrl) return null;
  if (!provider.accountIdEnvName) return provider.baseUrl;

  const accountId = process.env[provider.accountIdEnvName]?.trim();
  if (!accountId || !/^[a-f0-9]{32}$/i.test(accountId)) return null;
  return `${provider.baseUrl.replace(/\/+$/, "")}/${accountId}/ai/v1`;
}

function getProviderConfigurationError(provider: ProviderDefinition): string | null {
  if (provider.transport === "replit-integration") {
    const baseUrlEnvName = provider.integrationBaseUrlEnvName ?? "AI_INTEGRATIONS_OPENAI_BASE_URL";
    return process.env[provider.secretName]?.trim() && process.env[baseUrlEnvName]?.trim()
      ? null
      : `${provider.name} no está configurado con una integración válida.`;
  }

  // Workspace-owned provider keys are deliberately disabled in production.
  if (process.env.NODE_ENV === "production") {
    return `${provider.name} usa una clave propia, deshabilitada en producción.`;
  }
  if (!process.env[provider.secretName]?.trim()) {
    return `Falta configurar ${provider.secretName} en Replit Secrets.`;
  }
  if (provider.accountIdEnvName) {
    const accountId = process.env[provider.accountIdEnvName]?.trim();
    if (!accountId) {
      return `Falta configurar ${provider.accountIdEnvName} como variable de desarrollo.`;
    }
    if (!/^[a-f0-9]{32}$/i.test(accountId)) {
      return `${provider.accountIdEnvName} no tiene el formato esperado para un Account ID de Cloudflare.`;
    }
  }
  if (!getOpenAICompatibleBaseUrl(provider)) {
    return `${provider.name} no tiene una dirección de API válida.`;
  }
  return null;
}

function isConfigured(provider: ProviderDefinition): boolean {
  return getProviderConfigurationError(provider) === null;
}

function currentSuspension(health: ProviderHealth, now = Date.now()): string | null {
  if (!health.suspendedUntil || health.suspendedUntil <= now) {
    health.suspendedUntil = null;
    return null;
  }
  return new Date(health.suspendedUntil).toISOString();
}

function safeErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : "Error desconocido del proveedor.";
  return raw
    .replace(/\b(?:sk|gsk|gsk_proj)_[A-Za-z0-9_-]{8,}\b/gi, "[clave oculta]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [clave oculta]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 220) || "El proveedor no respondió correctamente.";
}

function normalizeProviderContent(provider: ProviderDefinition, content: string): string {
  const normalized = provider.stripReasoningMarkup
    ? content.replace(/<think\b[^>]*>[\s\S]*?(?:<\/think\s*>|$)/gi, "")
    : content;
  return normalized.trim();
}

function updateSuccess(providerId: string, latencyMs: number, isTest: boolean): void {
  const health = getHealth(providerId);
  health.successes += 1;
  health.reliability = Math.min(100, health.reliability + 4);
  health.consecutiveFailures = 0;
  health.suspendedUntil = null;
  health.lastLatencyMs = Math.max(0, Math.round(latencyMs));
  health.lastError = null;
  if (isTest) health.lastTestAt = new Date().toISOString();
}

function updateFailure(
  providerId: string,
  error: unknown,
  latencyMs: number,
  isTest: boolean,
): void {
  const health = getHealth(providerId);
  health.failures += 1;
  health.consecutiveFailures += 1;
  health.reliability = Math.max(0, health.reliability - 20);
  health.suspendedUntil = Date.now() + SUSPENSION_MS;
  health.lastLatencyMs = Math.max(0, Math.round(latencyMs));
  health.lastError = safeErrorMessage(error);
  if (isTest) health.lastTestAt = new Date().toISOString();
}

export function getProviderStatuses() {
  const now = Date.now();
  return providers.map((provider) => {
    const health = getHealth(provider.id);
    return {
      id: provider.id,
      name: provider.name,
      configured: isConfigured(provider),
      model: provider.model,
      secretName: provider.secretName,
      capabilities: provider.capabilities,
      reliability: health.reliability,
      successes: health.successes,
      failures: health.failures,
      consecutiveFailures: health.consecutiveFailures,
      suspendedUntil: currentSuspension(health, now),
      lastLatencyMs: health.lastLatencyMs,
      lastError: health.lastError,
      lastTestAt: health.lastTestAt,
    };
  });
}

export function getProviderName(providerId: string): string {
  return findProvider(providerId).name;
}

export async function createProviderCompletion(
  providerId: string,
  messages: ProviderChatMessages,
  options: { maxTokens: number; jsonMode: boolean },
): Promise<string> {
  const provider = findProvider(providerId);
  const configurationError = getProviderConfigurationError(provider);
  if (configurationError) throw new Error(configurationError);

  if (provider.transport === "replit-integration" && provider.integrationClient === "openrouter") {
    const { openrouter, batchProcess } = await import("@workspace/integrations-openrouter-ai");
    const [completion] = await batchProcess(
      [0],
      async () =>
        openrouter.chat.completions.create(
          {
            model: provider.model,
            messages,
            max_tokens: Math.max(options.maxTokens, provider.minimumTokenLimit ?? 0),
            ...(options.jsonMode ? { response_format: { type: "json_object" as const } } : {}),
          },
          { signal: AbortSignal.timeout(provider.requestTimeoutMs ?? REQUEST_TIMEOUT_MS) },
        ),
      { concurrency: 1, retries: 5, minTimeout: 1_000, maxTimeout: 16_000 },
    );
    const content = completion.choices[0]?.message?.content;
    if (typeof content !== "string") {
      throw new Error(`${provider.name} devolvió una respuesta vacía.`);
    }
    const normalizedContent = normalizeProviderContent(provider, content);
    if (!normalizedContent) throw new Error(`${provider.name} devolvió una respuesta vacía.`);
    return normalizedContent;
  }

  if (provider.transport === "replit-integration") {
    const completion = await openai.chat.completions.create(
      {
        model: provider.model,
        messages,
        max_completion_tokens: options.maxTokens,
        ...(options.jsonMode ? { response_format: { type: "json_object" as const } } : {}),
      },
      { signal: AbortSignal.timeout(provider.requestTimeoutMs ?? REQUEST_TIMEOUT_MS) },
    );
    const content = completion.choices[0]?.message?.content;
    if (typeof content !== "string") {
      throw new Error(`${provider.name} devolvió una respuesta vacía.`);
    }
    const normalizedContent = normalizeProviderContent(provider, content);
    if (!normalizedContent) throw new Error(`${provider.name} devolvió una respuesta vacía.`);
    return normalizedContent;
  }

  const baseUrl = getOpenAICompatibleBaseUrl(provider);
  if (!baseUrl) throw new Error(`${provider.name} no tiene una dirección configurada.`);
  const endpoint = new URL("chat/completions", `${baseUrl.replace(/\/+$/, "")}/`);
  const requestBody = {
    model: provider.model,
    messages,
    [provider.tokenLimitParameter ?? "max_completion_tokens"]: options.maxTokens,
    ...(options.jsonMode ? { response_format: { type: "json_object" } } : {}),
  };
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env[provider.secretName]?.trim()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
    signal: AbortSignal.timeout(provider.requestTimeoutMs ?? REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`${provider.name} respondió con HTTP ${response.status}.`);
  }

  const payload: unknown = await response.json();
  if (!payload || typeof payload !== "object" || !("choices" in payload) || !Array.isArray(payload.choices)) {
    throw new Error(`${provider.name} devolvió una respuesta con formato inesperado.`);
  }
  const firstChoice: unknown = payload.choices[0];
  if (!firstChoice || typeof firstChoice !== "object" || !("message" in firstChoice)) {
    throw new Error(`${provider.name} no devolvió un mensaje.`);
  }
  const message: unknown = firstChoice.message;
  if (!message || typeof message !== "object" || !("content" in message) || typeof message.content !== "string") {
    throw new Error(`${provider.name} devolvió una respuesta vacía.`);
  }
  const normalizedContent = normalizeProviderContent(provider, message.content);
  if (!normalizedContent) {
    const finishReason =
      "finish_reason" in firstChoice && typeof firstChoice.finish_reason === "string"
        ? ` (motivo: ${firstChoice.finish_reason})`
        : "";
    throw new Error(`${provider.name} devolvió una respuesta vacía${finishReason}.`);
  }
  return normalizedContent;
}

export async function runWithProviderFallback<T>(
  preference: ProviderPreference,
  capabilities: ProviderCapability[],
  task: (provider: ProviderDefinition) => Promise<T>,
): Promise<{ value: T; provider: ProviderDefinition; attempts: number }> {
  const statuses = getProviderStatuses();
  const compatibleProviders = providers.filter((provider) => {
    const status = statuses.find((item) => item.id === provider.id);
    return Boolean(status?.configured) &&
      capabilities.every((capability) => provider.capabilities.includes(capability));
  });
  const candidates = compatibleProviders
    .filter((provider) => !statuses.find((item) => item.id === provider.id)?.suspendedUntil)
    .sort((left, right) => {
      if (left.id === preference) return -1;
      if (right.id === preference) return 1;
      return getHealth(right.id).reliability - getHealth(left.id).reliability;
    });

  if (!candidates.length) {
    if (!statuses.some((status) => status.configured)) throw new Error("No hay proveedores de IA configurados.");
    if (!compatibleProviders.length) {
      const missingCapabilities = capabilities.join(", ");
      throw new Error(`Ningún proveedor configurado tiene todas las capacidades necesarias (${missingCapabilities}).`);
    }
    throw new Error("Los proveedores compatibles están suspendidos temporalmente. Probá su test en Configuración.");
  }

  let lastError: unknown = null;
  for (const [index, provider] of candidates.entries()) {
    const startedAt = Date.now();
    try {
      const value = await task(provider);
      updateSuccess(provider.id, Date.now() - startedAt, false);
      return { value, provider, attempts: index + 1 };
    } catch (error) {
      updateFailure(provider.id, error, Date.now() - startedAt, false);
      lastError = error;
    }
  }
  throw new Error(
    `Fallaron todos los proveedores compatibles. ${safeErrorMessage(lastError)}`,
  );
}

async function testOneProvider(provider: ProviderDefinition): Promise<ProviderTestResult> {
  const health = getHealth(provider.id);
  const configurationError = getProviderConfigurationError(provider);
  if (configurationError) {
    return {
      providerId: provider.id,
      name: provider.name,
      status: "missing-key",
      latencyMs: null,
      reliability: health.reliability,
      testedCapabilities: [],
      suspendedUntil: currentSuspension(health),
      error: configurationError,
    };
  }

  const startedAt = Date.now();
  const testedCapabilities: ProviderCapability[] = [];
  try {
    const textResult = await createProviderCompletion(
      provider.id,
      [
        { role: "system", content: "Respondé con una sola palabra breve." },
        { role: "user", content: "Respondé OK." },
      ],
      { maxTokens: 512, jsonMode: false },
    );
    if (!textResult.trim()) throw new Error("La prueba de texto no devolvió contenido.");
    testedCapabilities.push("text");

    const jsonResult = await createProviderCompletion(
      provider.id,
      [
        { role: "system", content: "Respondé exclusivamente JSON válido con la propiedad ok en true." },
        { role: "user", content: "Prueba de salida JSON." },
      ],
      { maxTokens: 768, jsonMode: true },
    );
    const parsedJson = parseJsonObject(jsonResult, "La prueba JSON no devolvió JSON válido.");
    if (!parsedJson || typeof parsedJson !== "object" || !("ok" in parsedJson) || parsedJson.ok !== true) {
      throw new Error("La prueba JSON no devolvió el objeto esperado.");
    }
    testedCapabilities.push("json");

    if (provider.capabilities.includes("planning")) {
      const planningResult = await createProviderCompletion(
        provider.id,
        [
          {
            role: "system",
            content: "Devolvé exclusivamente un objeto JSON con esta forma exacta: {\"tasks\":[\"paso breve\"]}. No agregues explicaciones fuera del objeto.",
          },
          { role: "user", content: "Dividí en pasos: mostrar una lista de hábitos." },
        ],
        { maxTokens: 2_048, jsonMode: true },
      );
      const parsedPlan = parseJsonObject(planningResult, "La prueba de planificación no devolvió JSON válido.");
      if (!parsedPlan || typeof parsedPlan !== "object" || !("tasks" in parsedPlan) || !Array.isArray(parsedPlan.tasks) || !parsedPlan.tasks.length) {
        throw new Error("La prueba de planificación no devolvió tareas.");
      }
      testedCapabilities.push("planning");
    }

    if (provider.capabilities.includes("vision")) {
      const visionResult = await createProviderCompletion(
        provider.id,
        [
          { role: "system", content: "Describí en pocas palabras el contenido de la imagen." },
          {
            role: "user",
            content: [
              { type: "text", text: "¿Qué podés ver en esta imagen?" },
              { type: "image_url", image_url: { url: VISION_TEST_PNG, detail: "high" } },
            ],
          },
        ],
        { maxTokens: 1_024, jsonMode: false },
      );
      if (!visionResult.trim()) throw new Error("La prueba visual no devolvió contenido.");
      testedCapabilities.push("vision");
    }

    const latencyMs = Date.now() - startedAt;
    updateSuccess(provider.id, latencyMs, true);
    return {
      providerId: provider.id,
      name: provider.name,
      status: "passed",
      latencyMs: Math.round(latencyMs),
      reliability: getHealth(provider.id).reliability,
      testedCapabilities,
      suspendedUntil: null,
      error: null,
    };
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    updateFailure(provider.id, error, latencyMs, true);
    return {
      providerId: provider.id,
      name: provider.name,
      status: "failed",
      latencyMs: Math.round(latencyMs),
      reliability: getHealth(provider.id).reliability,
      testedCapabilities,
      suspendedUntil: currentSuspension(getHealth(provider.id)),
      error: safeErrorMessage(error),
    };
  }
}

export async function testProviders(providerId: string) {
  const selectedProviders = providerId === "all"
    ? providers
    : [findProvider(providerId)];
  const results: ProviderTestResult[] = [];
  for (const provider of selectedProviders) {
    results.push(await testOneProvider(provider));
  }
  return results;
}