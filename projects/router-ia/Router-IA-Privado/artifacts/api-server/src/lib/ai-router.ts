import {
  createCipheriv,
  createDecipheriv,
  createHash,
  hkdfSync,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { isIP } from "node:net";
import type { AiProvider } from "@workspace/db";

export type ProviderKind =
  | "openai"
  | "anthropic"
  | "gemini"
  | "openai-compatible";

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ProviderConfig = Pick<
  AiProvider,
  "kind" | "model" | "baseUrl"
> & {
  apiKey: string;
};

export type NormalizedChatResult = {
  content: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
};

export class ProviderRequestError extends Error {
  readonly statusCode: number;

  constructor(
    message: string,
    statusCode = 502,
  ) {
    super(message);
    this.name = "ProviderRequestError";
    this.statusCode = statusCode;
  }
}

function encryptionKey(): Buffer {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("SESSION_SECRET is required to protect provider keys.");
  }

  return Buffer.from(
    hkdfSync(
      "sha256",
      Buffer.from(secret),
      Buffer.from("router-ia:key-encryption:v1"),
      Buffer.from("provider-api-keys"),
      32,
    ),
  );
}

export function encryptApiKey(apiKey: string): {
  apiKeyCiphertext: string;
  apiKeyIv: string;
  apiKeyTag: string;
  apiKeyPreview: string;
} {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(apiKey, "utf8"),
    cipher.final(),
  ]);

  return {
    apiKeyCiphertext: ciphertext.toString("base64"),
    apiKeyIv: iv.toString("base64"),
    apiKeyTag: cipher.getAuthTag().toString("base64"),
    apiKeyPreview: maskApiKey(apiKey),
  };
}

export function decryptApiKey(provider: AiProvider): string {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(provider.apiKeyIv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(provider.apiKeyTag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(provider.apiKeyCiphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

export function maskApiKey(apiKey: string): string {
  const suffix = apiKey.slice(-4);
  const prefix = apiKey.length > 12 ? apiKey.slice(0, 5) : "";
  return `${prefix}••••••${suffix}`;
}

export function normalizeCustomBaseUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error("Enter a valid HTTPS API address.");
  }

  const hostname = url.hostname.toLowerCase();
  const ipVersion = isIP(hostname);
  const privateIpv4 =
    ipVersion === 4 &&
    (/^(10|127|0)\./.test(hostname) ||
      /^169\.254\./.test(hostname) ||
      /^192\.168\./.test(hostname) ||
      (() => {
        const second = Number(hostname.split(".")[1]);
        return hostname.startsWith("172.") && second >= 16 && second <= 31;
      })());
  const localIpv6 =
    ipVersion === 6 &&
    (hostname === "::1" ||
      hostname.startsWith("fc") ||
      hostname.startsWith("fd") ||
      hostname.startsWith("fe80:"));

  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    privateIpv4 ||
    localIpv6
  ) {
    throw new Error("Use a public HTTPS API address for this provider.");
  }

  return url.toString().replace(/\/+$/, "");
}

function baseUrlFor(provider: ProviderConfig): string {
  switch (provider.kind) {
    case "openai":
      return "https://api.openai.com/v1";
    case "anthropic":
      return "https://api.anthropic.com/v1";
    case "gemini":
      return "https://generativelanguage.googleapis.com/v1beta";
    case "openai-compatible":
      if (!provider.baseUrl) {
        throw new ProviderRequestError(
          "An HTTPS API address is required for this provider.",
          400,
        );
      }
      return normalizeCustomBaseUrl(provider.baseUrl);
  }
  throw new ProviderRequestError("Unsupported provider type.", 400);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function safeErrorMessage(message: string, apiKey: string): string {
  return message.replaceAll(apiKey, "[hidden]").slice(0, 260);
}

async function requestJson(
  url: string,
  init: RequestInit,
  apiKey: string,
): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      redirect: "error",
      signal: AbortSignal.timeout(45_000),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not reach the provider.";
    throw new ProviderRequestError(safeErrorMessage(message, apiKey), 502);
  }

  const responseText = await response.text();
  if (responseText.length > 1_000_000) {
    throw new ProviderRequestError("The provider response was too large.");
  }

  let payload: Record<string, unknown>;
  try {
    payload = asRecord(JSON.parse(responseText) as unknown);
  } catch {
    throw new ProviderRequestError(
      response.ok
        ? "The provider returned an unreadable response."
        : `The provider returned HTTP ${response.status}.`,
      response.ok ? 502 : response.status,
    );
  }

  if (!response.ok) {
    const errorObject = asRecord(payload.error);
    const message =
      typeof errorObject.message === "string"
        ? errorObject.message
        : typeof payload.message === "string"
          ? payload.message
          : `The provider returned HTTP ${response.status}.`;
    throw new ProviderRequestError(
      safeErrorMessage(message, apiKey),
      response.status,
    );
  }

  return payload;
}

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function getOpenAICompatibleText(payload: Record<string, unknown>): string {
  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  const message = asRecord(asRecord(choices[0]).message);
  if (typeof message.content === "string") {
    return message.content;
  }
  if (Array.isArray(message.content)) {
    return message.content
      .map((part) => asRecord(part))
      .filter((part) => part.type === "text" && typeof part.text === "string")
      .map((part) => part.text as string)
      .join("");
  }
  return "";
}

export async function runProviderChat(
  provider: ProviderConfig,
  messages: ChatMessage[],
  options: {
    temperature?: number;
    maxTokens?: number;
    model?: string;
  } = {},
): Promise<NormalizedChatResult> {
  const model = options.model?.trim() || provider.model;
  const temperature = options.temperature ?? 0.4;
  const maxTokens = options.maxTokens ?? 512;
  const baseUrl = baseUrlFor(provider);

  if (provider.kind === "anthropic") {
    const system = messages
      .filter((message) => message.role === "system")
      .map((message) => message.content)
      .join("\n\n");
    const anthropicMessages = messages
      .filter((message) => message.role !== "system")
      .map((message) => ({
        role: message.role === "assistant" ? "assistant" : "user",
        content: message.content,
      }));
    const payload = await requestJson(
      `${baseUrl}/messages`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": provider.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          temperature,
          ...(system ? { system } : {}),
          messages: anthropicMessages,
        }),
      },
      provider.apiKey,
    );
    const usage = asRecord(payload.usage);
    const blocks = Array.isArray(payload.content) ? payload.content : [];

    return {
      content: blocks
        .map((block) => asRecord(block))
        .filter((block) => block.type === "text" && typeof block.text === "string")
        .map((block) => block.text as string)
        .join(""),
      model: typeof payload.model === "string" ? payload.model : model,
      promptTokens: asNumber(usage.input_tokens),
      completionTokens: asNumber(usage.output_tokens),
    };
  }

  if (provider.kind === "gemini") {
    const system = messages
      .filter((message) => message.role === "system")
      .map((message) => message.content)
      .join("\n\n");
    const contents = messages
      .filter((message) => message.role !== "system")
      .map((message) => ({
        role: message.role === "assistant" ? "model" : "user",
        parts: [{ text: message.content }],
      }));
    const url = new URL(
      `${baseUrl}/models/${encodeURIComponent(model)}:generateContent`,
    );
    url.searchParams.set("key", provider.apiKey);
    const payload = await requestJson(
      url.toString(),
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...(system
            ? { systemInstruction: { parts: [{ text: system }] } }
            : {}),
          contents,
          generationConfig: {
            temperature,
            maxOutputTokens: maxTokens,
          },
        }),
      },
      provider.apiKey,
    );
    const candidates = Array.isArray(payload.candidates)
      ? payload.candidates
      : [];
    const candidate = asRecord(candidates[0]);
    const content = asRecord(candidate.content);
    const parts = Array.isArray(content.parts) ? content.parts : [];
    const usage = asRecord(payload.usageMetadata);

    return {
      content: parts
        .map((part) => asRecord(part))
        .filter((part) => typeof part.text === "string")
        .map((part) => part.text as string)
        .join(""),
      model:
        typeof payload.modelVersion === "string" ? payload.modelVersion : model,
      promptTokens: asNumber(usage.promptTokenCount),
      completionTokens: asNumber(usage.candidatesTokenCount),
    };
  }

  const payload = await requestJson(
    `${baseUrl}/chat/completions`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${provider.apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature,
        max_tokens: maxTokens,
        stream: false,
      }),
    },
    provider.apiKey,
  );
  const usage = asRecord(payload.usage);
  const content = getOpenAICompatibleText(payload);
  if (!content) {
    throw new ProviderRequestError(
      "The provider responded, but did not return any text.",
    );
  }

  return {
    content,
    model: typeof payload.model === "string" ? payload.model : model,
    promptTokens: asNumber(usage.prompt_tokens),
    completionTokens: asNumber(usage.completion_tokens),
  };
}

export function createOpenAIChatCompletion(
  result: NormalizedChatResult,
): {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: { role: "assistant"; content: string };
    finish_reason: "stop";
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
} {
  return {
    id: `chatcmpl-${randomUUID()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: result.model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: result.content },
        finish_reason: "stop",
      },
    ],
    usage: {
      prompt_tokens: result.promptTokens,
      completion_tokens: result.completionTokens,
      total_tokens: result.promptTokens + result.completionTokens,
    },
  };
}

export function hashRouterToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function issueRouterToken(): string {
  return `ria_live_${randomBytes(32).toString("base64url")}`;
}