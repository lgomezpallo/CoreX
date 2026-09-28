import { openai } from "@workspace/integrations-openai-ai-server";
import { parseJsonObject } from "./json-output";
import {
  getRouterConfigurationError,
  routerChat,
  testRouterConnection,
} from "./router-client";

export type ProviderCapability = "text" | "json" | "planning" | "vision";
export type ProviderPreference = string;

export type ProviderChatMessages = Parameters<typeof openai.chat.completions.create>[0]["messages"];

type ProviderDefinition = {
  id: string;
  name: string;
  model: string;
  secretName: string;
  capabilities: ProviderCapability[];
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

const ROUTER_PROVIDER: ProviderDefinition = {
  id: "router-ia",
  name: "Router IA",
  model: "catálogo automático",
  secretName: "ROUTER_APP_KEY",
  capabilities: ["text", "json", "planning", "vision"],
};

const SUSPENSION_MS = 60_000;
const health: ProviderHealth = {
  reliability: 100,
  successes: 0,
  failures: 0,
  consecutiveFailures: 0,
  suspendedUntil: null,
  lastLatencyMs: null,
  lastError: null,
  lastTestAt: null,
};

function safeErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : "Error desconocido de Router IA.";
  return raw
    .replace(/ria_live_[A-Za-z0-9_-]+/g, "[App Key oculta]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [clave oculta]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 220) || "Router IA no respondió correctamente.";
}

function currentSuspension(now = Date.now()): string | null {
  if (!health.suspendedUntil || health.suspendedUntil <= now) {
    health.suspendedUntil = null;
    return null;
  }
  return new Date(health.suspendedUntil).toISOString();
}

function updateSuccess(latencyMs: number, isTest: boolean): void {
  health.successes += 1;
  health.reliability = Math.min(100, health.reliability + 2);
  health.consecutiveFailures = 0;
  health.suspendedUntil = null;
  health.lastLatencyMs = Math.max(0, Math.round(latencyMs));
  health.lastError = null;
  if (isTest) health.lastTestAt = new Date().toISOString();
}

function updateFailure(error: unknown, latencyMs: number, isTest: boolean): void {
  health.failures += 1;
  health.consecutiveFailures += 1;
  health.reliability = Math.max(0, health.reliability - 15);
  health.suspendedUntil = Date.now() + SUSPENSION_MS;
  health.lastLatencyMs = Math.max(0, Math.round(latencyMs));
  health.lastError = safeErrorMessage(error);
  if (isTest) health.lastTestAt = new Date().toISOString();
}

function assertRouterProvider(providerId: string): ProviderDefinition {
  if (providerId !== ROUTER_PROVIDER.id && providerId !== "auto") {
    throw new Error("Esta aplicación usa Router IA como única capa de inteligencia artificial.");
  }
  return ROUTER_PROVIDER;
}

export function getProviderStatuses() {
  const configurationError = getRouterConfigurationError();
  return [{
    id: ROUTER_PROVIDER.id,
    name: ROUTER_PROVIDER.name,
    configured: configurationError === null,
    model: ROUTER_PROVIDER.model,
    secretName: ROUTER_PROVIDER.secretName,
    capabilities: ROUTER_PROVIDER.capabilities,
    reliability: health.reliability,
    successes: health.successes,
    failures: health.failures,
    consecutiveFailures: health.consecutiveFailures,
    suspendedUntil: currentSuspension(),
    lastLatencyMs: health.lastLatencyMs,
    lastError: configurationError ?? health.lastError,
    lastTestAt: health.lastTestAt,
  }];
}

export function getProviderName(_providerId: string): string {
  return ROUTER_PROVIDER.name;
}

export async function createProviderCompletion(
  providerId: string,
  messages: ProviderChatMessages,
  options: { maxTokens: number; jsonMode: boolean },
): Promise<string> {
  assertRouterProvider(providerId);
  const configurationError = getRouterConfigurationError();
  if (configurationError) throw new Error(configurationError);

  const routedMessages = messages as unknown as Array<{
    role: "system" | "user" | "assistant";
    content: unknown;
  }>;
  const result = await routerChat(routedMessages, {
    taskType: "coding",
    maxTokens: options.maxTokens,
    temperature: options.jsonMode ? 0.2 : 0.5,
  });
  return result.content;
}

export async function runWithProviderFallback<T>(
  _preference: ProviderPreference,
  capabilities: ProviderCapability[],
  task: (provider: ProviderDefinition) => Promise<T>,
): Promise<{ value: T; provider: ProviderDefinition; attempts: number }> {
  const configurationError = getRouterConfigurationError();
  if (configurationError) throw new Error(configurationError);
  if (currentSuspension()) throw new Error("Router IA está temporalmente en pausa después de un error. Probá la conexión nuevamente.");

  const unsupported = capabilities.filter(capability => !ROUTER_PROVIDER.capabilities.includes(capability));
  if (unsupported.length) {
    throw new Error(`Router IA no declaró estas capacidades para esta app: ${unsupported.join(", ")}.`);
  }

  const startedAt = Date.now();
  try {
    const value = await task(ROUTER_PROVIDER);
    updateSuccess(Date.now() - startedAt, false);
    return { value, provider: ROUTER_PROVIDER, attempts: 1 };
  } catch (error) {
    updateFailure(error, Date.now() - startedAt, false);
    throw new Error(`Router IA no pudo completar la tarea. ${safeErrorMessage(error)}`);
  }
}

async function testRouterProvider(): Promise<ProviderTestResult> {
  const configurationError = getRouterConfigurationError();
  if (configurationError) {
    return {
      providerId: ROUTER_PROVIDER.id,
      name: ROUTER_PROVIDER.name,
      status: "missing-key",
      latencyMs: null,
      reliability: health.reliability,
      testedCapabilities: [],
      suspendedUntil: currentSuspension(),
      error: configurationError,
    };
  }

  const startedAt = Date.now();
  try {
    const connection = await testRouterConnection();

    const json = await routerChat(
      [
        { role: "system", content: "Respondé exclusivamente JSON válido con la propiedad ok en true." },
        { role: "user", content: "Prueba JSON de Programa Hablando." },
      ],
      { taskType: "coding", maxTokens: 256, temperature: 0 },
    );
    const parsedJson = parseJsonObject(json.content, "Router IA no devolvió JSON válido en la prueba.");
    if (!parsedJson || typeof parsedJson !== "object" || !("ok" in parsedJson) || parsedJson.ok !== true) {
      throw new Error("Router IA no devolvió el JSON esperado.");
    }

    const latencyMs = Math.max(connection.latencyMs, Date.now() - startedAt);
    updateSuccess(latencyMs, true);
    return {
      providerId: ROUTER_PROVIDER.id,
      name: ROUTER_PROVIDER.name,
      status: "passed",
      latencyMs,
      reliability: health.reliability,
      testedCapabilities: ["text", "json", "planning"],
      suspendedUntil: null,
      error: null,
    };
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    updateFailure(error, latencyMs, true);
    return {
      providerId: ROUTER_PROVIDER.id,
      name: ROUTER_PROVIDER.name,
      status: "failed",
      latencyMs,
      reliability: health.reliability,
      testedCapabilities: [],
      suspendedUntil: currentSuspension(),
      error: safeErrorMessage(error),
    };
  }
}

export async function testProviders(providerId: string) {
  if (providerId !== "all" && providerId !== ROUTER_PROVIDER.id && providerId !== "auto") {
    throw new Error("El único proveedor de esta app es Router IA.");
  }
  return [await testRouterProvider()];
}
