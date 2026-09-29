import {
  normalizeBaseUrl,
  providerConfigs,
  type RouterProviderConfig,
} from "./router-providers";

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

export type CompletionOptions = {
  maxTokens: number;
  jsonMode: boolean;
};

const REQUEST_TIMEOUT_MS = 120_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function finalModelText(value: string): string {
  let text = value;
  for (const tag of ["think", "analysis", "reasoning"]) {
    text = text.replace(
      new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\s*>`, "gi"),
      "",
    );
  }
  const finalBlock = /<(?:final|answer)\b[^>]*>([\s\S]*?)<\/(?:final|answer)\s*>/i.exec(text);
  if (finalBlock) text = finalBlock[1];
  if (/<(?:think|analysis|reasoning)\b/i.test(text)) {
    throw new Error("El proveedor devolvió etiquetas de razonamiento sin una respuesta final.");
  }
  const result = text.trim();
  if (!result) throw new Error("Router IA devolvió una respuesta vacía.");
  return result;
}

function extractOpenAiContent(payload: unknown): string {
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
  return finalModelText(content);
}

function parseDataImage(url: string): { mimeType: string; data: string } | null {
  const match = /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/=]+)$/i.exec(url);
  return match ? { mimeType: match[1].toLowerCase(), data: match[2] } : null;
}

function anthropicContent(content: RouterChatMessage["content"]): string | Array<Record<string, unknown>> {
  if (typeof content === "string") return content;
  return content.map((part) => {
    if (part.type === "text") return { type: "text", text: part.text };
    const inlineImage = parseDataImage(part.image_url.url);
    if (inlineImage) {
      return {
        type: "image",
        source: {
          type: "base64",
          media_type: inlineImage.mimeType,
          data: inlineImage.data,
        },
      };
    }
    if (!part.image_url.url.startsWith("https://")) {
      throw new Error("Anthropic image URLs must use HTTPS or an image data URL.");
    }
    return {
      type: "image",
      source: { type: "url", url: part.image_url.url },
    };
  });
}

function geminiParts(content: RouterChatMessage["content"]): Array<Record<string, unknown>> {
  if (typeof content === "string") return [{ text: content }];
  return content.map((part) => {
    if (part.type === "text") return { text: part.text };
    const image = parseDataImage(part.image_url.url);
    if (!image) {
      throw new Error("Gemini necesita imágenes adjuntas en formato base64; se intentará otro proveedor.");
    }
    return { inlineData: { mimeType: image.mimeType, data: image.data } };
  });
}

function safeProviderError(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  const httpStatus = /Provider returned HTTP \d+\./.exec(message);
  if (httpStatus) return httpStatus[0];
  if (message.startsWith("Gemini necesita imágenes") ||
      message.startsWith("Anthropic image URLs")) {
    return message;
  }
  if (message.startsWith("El proveedor")) return message;
  return "No se pudo conectar con el proveedor.";
}

export async function createProviderCompletion(
  provider: RouterProviderConfig,
  messages: RouterChatMessage[],
  options: CompletionOptions,
): Promise<string> {
  const system = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n");
  const conversational = messages.filter((message) => message.role !== "system");

  if (provider.kind === "anthropic") {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": provider.apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: provider.model,
        max_tokens: options.maxTokens,
        ...(system ? { system } : {}),
        messages: conversational.map((message) => ({
          role: message.role === "assistant" ? "assistant" : "user",
          content: anthropicContent(message.content),
        })),
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      redirect: "error",
    });
    if (!response.ok) throw new Error(`Provider returned HTTP ${response.status}.`);
    const payload = await response.json() as Record<string, unknown>;
    const text = Array.isArray(payload.content)
      ? payload.content
        .filter(isRecord)
        .map((part) => typeof part.text === "string" ? part.text : "")
        .join("")
        .trim()
      : "";
    return finalModelText(text);
  }

  if (provider.kind === "gemini") {
    const endpoint = new URL(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(provider.model)}:generateContent`,
    );
    endpoint.searchParams.set("key", provider.apiKey);
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
        contents: conversational.map((message) => ({
          role: message.role === "assistant" ? "model" : "user",
          parts: geminiParts(message.content),
        })),
        generationConfig: {
          maxOutputTokens: options.maxTokens,
          ...(options.jsonMode ? { responseMimeType: "application/json" } : {}),
        },
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      redirect: "error",
    });
    if (!response.ok) throw new Error(`Provider returned HTTP ${response.status}.`);
    const payload = await response.json() as Record<string, unknown>;
    const candidate = Array.isArray(payload.candidates) ? payload.candidates[0] : null;
    const content = isRecord(candidate) && isRecord(candidate.content) ? candidate.content : null;
    const text = content && Array.isArray(content.parts)
      ? content.parts
        .filter(isRecord)
        .map((part) => typeof part.text === "string" ? part.text : "")
        .join("")
        .trim()
      : "";
    return finalModelText(text);
  }

  const base = provider.kind === "openai"
    ? "https://api.openai.com/v1"
    : provider.kind === "groq"
      ? "https://api.groq.com/openai/v1"
      : provider.baseUrl
        ? normalizeBaseUrl(provider.baseUrl)
        : null;
  if (!base) throw new Error("El proveedor no tiene una URL válida.");

  const response = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${provider.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: provider.model,
      messages,
      max_tokens: options.maxTokens,
      ...(options.jsonMode ? { response_format: { type: "json_object" } } : {}),
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    redirect: "error",
  });
  if (!response.ok) throw new Error(`Provider returned HTTP ${response.status}.`);
  return extractOpenAiContent(await response.json());
}

export async function createRouterCompletion(
  taskType: RouterTaskType,
  messages: RouterChatMessage[],
  options: CompletionOptions,
  userId: string,
  accessToken: string,
): Promise<string> {
  if (!userId.trim() || !accessToken.trim()) {
    throw new Error("No hay una identidad autenticada para Router IA.");
  }
  const providers = (await providerConfigs(accessToken))
    .filter((provider) =>
      provider.capabilities.includes(taskType) ||
      provider.capabilities.includes("chat"),
    )
    .slice(0, 3);
  if (!providers.length) {
    throw new Error("No hay proveedores activos para esta tarea y esta cuenta.");
  }

  let lastError = "No se pudo conectar con el proveedor.";
  for (const provider of providers) {
    try {
      return await createProviderCompletion(provider, messages, options);
    } catch (error) {
      lastError = safeProviderError(error);
    }
  }
  throw new Error(`Fallaron los proveedores configurados: ${lastError}`);
}