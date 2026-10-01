import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
// @ts-expect-error Node's native TypeScript test runner requires the explicit extension.
import { createRouterCompletion, testRouterConnection, type RouterChatMessage } from "./router-client.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.ROUTER_IA_URL;
  delete process.env.ROUTER_IA_TOKEN;
  delete process.env.ROUTER_URL;
  delete process.env.ROUTER_APP_KEY;
});

const options = { maxTokens: 512, jsonMode: false };

test("sends every completion through the configured Router IA endpoint", async () => {
  process.env.ROUTER_IA_URL = "https://router.example.test/api/v1/chat/completions";
  process.env.ROUTER_IA_TOKEN = "ria_live_local_test_token";
  let requestUrl = "";
  let requestHeaders: Headers | undefined;
  let requestBody: Record<string, unknown> | undefined;

  globalThis.fetch = (async (input, init) => {
    requestUrl = String(input);
    requestHeaders = new Headers(init?.headers);
    requestBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({
      choices: [{ message: { content: "<think>private reasoning</think><final>Hola</final>" } }],
    }), { status: 200 });
  }) as typeof fetch;

  const messages: RouterChatMessage[] = [{ role: "user", content: "Respondé." }];
  const result = await createRouterCompletion("chat", messages, options);

  assert.equal(result, "Hola");
  assert.equal(requestUrl, "https://router.example.test/api/v1/chat/completions");
  assert.equal(requestHeaders?.get("authorization"), "Bearer ria_live_local_test_token");
  assert.deepEqual(requestBody, {
    task_type: "chat",
    messages,
    max_tokens: 512,
    stream: false,
  });
});

test("JSON mode adds an instruction instead of provider-specific request fields", async () => {
  process.env.ROUTER_URL = "https://router.example.test";
  process.env.ROUTER_APP_KEY = "local-test-app-key";
  let requestBody: Record<string, any> | undefined;

  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({
      choices: [{ message: { content: "{\"ok\":true}" } }],
    }), { status: 200 });
  }) as typeof fetch;

  await createRouterCompletion(
    "reasoning",
    [{ role: "user", content: "Devolvé JSON." }],
    { maxTokens: 200, jsonMode: true },
  );

  assert.equal(requestBody?.response_format, undefined);
  assert.equal(requestBody?.model, undefined);
  assert.equal(requestBody?.messages[0].role, "system");
  assert.match(requestBody?.messages[0].content, /objeto JSON válido/);
});

test("Router health check never sends a prompt or an authorization token", async () => {
  process.env.ROUTER_URL = "https://router.example.test";
  process.env.ROUTER_APP_KEY = "local-test-app-key";
  let requestUrl = "";
  let requestInit: RequestInit | undefined;

  globalThis.fetch = (async (input, init) => {
    requestUrl = String(input);
    requestInit = init;
    return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
  }) as typeof fetch;

  const status = await testRouterConnection("chat");

  assert.equal(requestUrl, "https://router.example.test/api/healthz");
  assert.equal(requestInit?.method, "GET");
  assert.equal(new Headers(requestInit?.headers).has("authorization"), false);
  assert.equal(requestInit?.body, undefined);
  assert.equal(status.configured, true);
  assert.equal(status.connected, true);
  assert.match(status.message ?? "", /token no se validó/i);
  assert.match(status.message ?? "", /no se consultaron modelos ni providers/i);
});

test("reports Router availability separately from missing completion credentials", async () => {
  process.env.ROUTER_URL = "https://router.example.test";
  delete process.env.ROUTER_APP_KEY;
  delete process.env.ROUTER_IA_TOKEN;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ status: "ok" }), { status: 200 })) as typeof fetch;

  const status = await testRouterConnection("chat");

  assert.equal(status.configured, false);
  assert.equal(status.connected, true);
  assert.match(status.message ?? "", /falta.*ROUTER_IA_TOKEN/i);
});

test("does not expose an upstream error body", async () => {
  process.env.ROUTER_URL = "https://router.example.test";
  process.env.ROUTER_APP_KEY = "local-test-app-key";
  globalThis.fetch = (async () => new Response(
    JSON.stringify({ error: { message: "private upstream error body" } }),
    { status: 401 },
  )) as typeof fetch;

  await assert.rejects(
    createRouterCompletion("chat", [{ role: "user", content: "Respondé." }], options),
    { message: "Router IA respondió con HTTP 401." },
  );
});

test("rejects an unexpected Router IA path rather than silently ignoring it", async () => {
  process.env.ROUTER_IA_URL = "https://router.example.test/unexpected/path";
  process.env.ROUTER_IA_TOKEN = "ria_live_local_test_token";

  await assert.rejects(
    createRouterCompletion("chat", [{ role: "user", content: "Respondé." }], options),
    /ROUTER_IA_URL debe ser HTTPS/,
  );
});