import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  createProviderCompletion,
  type RouterChatMessage,
} from "./router-client";
import type { RouterProviderConfig } from "./router-providers";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function provider(kind: RouterProviderConfig["kind"]): RouterProviderConfig {
  return {
    id: "unit-test-provider",
    kind,
    baseUrl: null,
    model: "unit-test-model",
    capabilities: ["chat", "vision"],
    priority: 1,
    isDefault: true,
    apiKey: "unit-test-key",
  };
}

const options = { maxTokens: 512, jsonMode: false };

test("removes private reasoning markup before returning OpenAI text", async () => {
  globalThis.fetch = (async () => new Response(JSON.stringify({
    choices: [{ message: { content: "<think>private reasoning</think><final>Respuesta visible</final>" } }],
  }), { status: 200 })) as typeof fetch;

  const result = await createProviderCompletion(
    provider("openai"),
    [{ role: "user", content: "Respondé." }],
    options,
  );

  assert.equal(result, "Respuesta visible");
  assert.equal(result.includes("private reasoning"), false);
});

test("sends Gemini image data as inlineData and returns its final text", async () => {
  const requestBodies: Record<string, any>[] = [];
  globalThis.fetch = (async (_input, init) => {
    requestBodies.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: "<think>private reasoning</think><final>Un paisaje</final>" }] } }],
    }), { status: 200 });
  }) as typeof fetch;

  const messages: RouterChatMessage[] = [{
    role: "user",
    content: [
      { type: "text", text: "¿Qué aparece?" },
      { type: "image_url", image_url: { url: "data:image/png;base64,aGVsbG8=" } },
    ],
  }];
  const result = await createProviderCompletion(provider("gemini"), messages, options);
  const contents = requestBodies[0]?.contents as Array<{ parts: Array<Record<string, any>> }>;

  assert.equal(result, "Un paisaje");
  assert.deepEqual(contents[0].parts[1].inlineData, {
    mimeType: "image/png",
    data: "aGVsbG8=",
  });
});

test("does not expose an upstream error body", async () => {
  globalThis.fetch = (async () => new Response(
    JSON.stringify({ error: { message: "sensitive upstream details" } }),
    { status: 401 },
  )) as typeof fetch;

  await assert.rejects(
    createProviderCompletion(
      provider("openai"),
      [{ role: "user", content: "Respondé." }],
      options,
    ),
    { message: "Provider returned HTTP 401." },
  );
});