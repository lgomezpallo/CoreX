export const ROUTER_TASK_TYPES = [
  "chat",
  "coding",
  "reasoning",
  "summarization",
  "vision",
  "document",
] as const;

export type RouterTaskType = (typeof ROUTER_TASK_TYPES)[number];

type RouterTextContent = {
  type: "text";
  text: string;
};

type RouterImageContent = {
  type: "image_url";
  image_url: {
    url: string;
    detail?: "auto" | "low" | "high";
  };
};

export type RouterChatMessage =
  | { role: "system" | "assistant"; content: string }
  | { role: "user"; content: string | Array<RouterTextContent | RouterImageContent> };

export type RouterConnectionStatus = {
  configured: boolean;
  connected: boolean;
  lastTestAt: string | null;
  lastLatencyMs: number | null;
  message: string | null;
};

type CompletionOptions = {
  maxTokens: number;
  jsonMode: boolean;
};

const DEFAULT_ROUTER_URL = "https://router-ia.luisgomezpallo.workers.dev";
const REQUEST_TIMEOUT_MS = 60_000;

const health = {
  connected: false,
  lastTestAt: null as string | null,
  lastLatencyMs: null as number | null,
  message: null as string | null,
};

function routerUrl(): URL | null {
  const value = process.env.ROUTER_URL?.trim() || DEFAULT_ROUTER_URL;
  try {
    const url = new URL(value);
    if (
      (url.protocol !== "https:" && url.protocol !== "http:") ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.pathname !== "/" && url.pathname !== "")
    ) {
      return null;
    }
    if (
      process.env.NODE_ENV === "production" &&
      url.protocol !== "https:"
    ) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

function configurationError(): string | null {
  if (!process.env.ROUTER_APP_KEY?.trim()) {
    return "Falta configurar ROUTER_APP_KEY en el entorno del servidor.";
  }
  if (!routerUrl()) {
    return "ROUTER_URL debe ser una dirección HTTPS válida del Router IA.";
  }
  return null;
}

function safeErrorMessage(error: unknown): string {
  const raw = error instanceof Error
    ? error.message
    : "No se pudo completar la solicitud al Router IA.";
  const appKey = process.env.ROUTER_APP_KEY?.trim();
  return raw
    .replace(/Bearer\s+[^\s]+/gi, "Bearer [clave oculta]")
    .replace(/\b(?:sk|gsk|rk)_[A-Za-z0-9_-]{8,}\b/gi, "[clave oculta]")
    .replace(appKey || /\u0000/g, appKey ? "[clave oculta]" : "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 220) || "Router IA no respondió correctamente.";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function extractContent(payload: unknown): string {
  if (!isRecord(payload) || !Array.isArray(payload.choices)) {
    throw new Error("Router IA devolvió una respuesta con formato inesperado.");
  }
  const choice = payload.choices[0];
  if (!isRecord(choice) || !isRecord(choice.message)) {
    throw new Error("Router IA no devolvió un mensaje.");
  }
  const content = choice.message.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("Router IA devolvió una respuesta vacía.");
  }
  return content.trim();
}

export async function createRouterCompletion(
  taskType: RouterTaskType,
  messages: RouterChatMessage[],
  options: CompletionOptions,
): Promise<string> {
  const configError = configurationError();
  if (configError) throw new Error(configError);

  const url = routerUrl();
  const appKey = process.env.ROUTER_APP_KEY?.trim();
  if (!url || !appKey) throw new Error("Router IA no está configurado.");

  const endpoint = new URL("/api/v1/chat/completions", url);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${appKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      task_type: taskType,
      messages,
      max_tokens: options.maxTokens,
      ...(options.jsonMode ? { response_format: { type: "json_object" } } : {}),
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Router IA respondió con HTTP ${response.status}.`);
  }

  return extractContent(await response.json());
}

export function getRouterStatus(): RouterConnectionStatus {
  const error = configurationError();
  return {
    configured: error === null,
    connected: error === null && health.connected,
    lastTestAt: health.lastTestAt,
    lastLatencyMs: health.lastLatencyMs,
    message: error ?? health.message,
  };
}

export async function testRouterConnection(
  taskType: RouterTaskType,
): Promise<RouterConnectionStatus> {
  const configError = configurationError();
  const startedAt = Date.now();

  if (configError) {
    health.connected = false;
    health.lastLatencyMs = null;
    health.message = configError;
    return getRouterStatus();
  }
  health.lastTestAt = new Date().toISOString();

  try {
    await createRouterCompletion(
      taskType,
      [
        { role: "system", content: "Respondé exactamente con la palabra OK." },
        { role: "user", content: "Prueba de conexión." },
      ],
      { maxTokens: 32, jsonMode: false },
    );
    health.connected = true;
    health.lastLatencyMs = Math.max(0, Math.round(Date.now() - startedAt));
    health.message = null;
  } catch (error) {
    health.connected = false;
    health.lastLatencyMs = Math.max(0, Math.round(Date.now() - startedAt));
    health.message = safeErrorMessage(error);
  }

  return getRouterStatus();
}