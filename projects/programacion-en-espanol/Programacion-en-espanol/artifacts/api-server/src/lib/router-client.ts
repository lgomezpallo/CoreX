export type RouterTaskType = "chat" | "coding" | "reasoning" | "summarization" | "vision" | "document";

export type RouterMessage = {
  role: "system" | "user" | "assistant";
  content: unknown;
};

type RouterChatOptions = {
  taskType?: RouterTaskType;
  maxTokens?: number;
  temperature?: number;
};

type RouterChatResult = {
  content: string;
  model: string;
};

const DEFAULT_ROUTER_URL = "https://router-ia.luisgomezpallo.workers.dev";
const REQUEST_TIMEOUT_MS = 90_000;

export function getRouterUrl(): string {
  return (process.env.ROUTER_URL?.trim() || DEFAULT_ROUTER_URL).replace(/\/+$/, "");
}

export function getRouterConfigurationError(): string | null {
  const key = process.env.ROUTER_APP_KEY?.trim();
  if (!key) return "Falta configurar ROUTER_APP_KEY como secreto del servidor.";
  if (!/^ria_live_[A-Za-z0-9_-]+$/.test(key)) return "ROUTER_APP_KEY no tiene el formato esperado de una App Key de Router IA.";
  return null;
}

function safeRouterError(payload: unknown, status: number): string {
  if (payload && typeof payload === "object" && "error" in payload) {
    const error = (payload as { error?: unknown }).error;
    if (typeof error === "string" && error.trim()) return error.trim().slice(0, 240);
    if (error && typeof error === "object" && "message" in error) {
      const message = (error as { message?: unknown }).message;
      if (typeof message === "string" && message.trim()) return message.trim().slice(0, 240);
    }
  }
  return `Router IA respondió con HTTP ${status}.`;
}

export async function routerChat(
  messages: RouterMessage[],
  options: RouterChatOptions = {},
): Promise<RouterChatResult> {
  const configurationError = getRouterConfigurationError();
  if (configurationError) throw new Error(configurationError);

  const endpoint = `${getRouterUrl()}/api/v1/chat/completions`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.ROUTER_APP_KEY!.trim()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messages,
      task_type: options.taskType ?? "coding",
      max_tokens: options.maxTokens ?? 4096,
      temperature: options.temperature ?? 0.4,
      stream: false,
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    // handled below
  }

  if (!response.ok) throw new Error(safeRouterError(payload, response.status));
  if (!payload || typeof payload !== "object" || !("choices" in payload) || !Array.isArray(payload.choices)) {
    throw new Error("Router IA devolvió una respuesta con formato inesperado.");
  }

  const first = payload.choices[0];
  if (!first || typeof first !== "object" || !("message" in first)) {
    throw new Error("Router IA no devolvió un mensaje.");
  }
  const message = (first as { message?: unknown }).message;
  if (!message || typeof message !== "object" || !("content" in message)) {
    throw new Error("Router IA devolvió una respuesta vacía.");
  }
  const content = (message as { content?: unknown }).content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("Router IA devolvió una respuesta vacía.");
  }

  const model = "model" in payload && typeof (payload as { model?: unknown }).model === "string"
    ? (payload as { model: string }).model
    : "router-auto";
  return { content: content.trim(), model };
}

export async function testRouterConnection(): Promise<{ latencyMs: number; model: string }> {
  const startedAt = Date.now();
  const result = await routerChat(
    [
      { role: "system", content: "Respondé solamente OK." },
      { role: "user", content: "Prueba de conexión de una aplicación a Router IA." },
    ],
    { taskType: "chat", maxTokens: 96, temperature: 0 },
  );
  return { latencyMs: Date.now() - startedAt, model: result.model };
}
