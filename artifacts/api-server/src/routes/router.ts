import { Router, type IRouter } from "express";
import {
  GetRouterStatusResponse,
  TestRouterConnectionBody,
  TestRouterConnectionResponse,
  ListRouterProvidersResponse,
  CreateRouterProviderBody,
  CreateRouterProviderResponse,
  UpdateRouterProviderBody,
  UpdateRouterProviderParams,
  UpdateRouterProviderResponse,
  DeleteRouterProviderParams,
  TestRouterProviderParams,
  TestRouterProviderResponse,
} from "@workspace/api-zod";
import {
  createProviderCompletion,
  type RouterChatMessage,
} from "../lib/router-client";
import {
  createProvider,
  deleteProvider,
  getProviderConfig,
  listProviders,
  providerConfigs,
  recordProviderTestResult,
  updateProvider,
  type RouterProviderConfig,
} from "../lib/router-providers";
import { requireSupabaseUser } from "../lib/supabase-auth";

const router: IRouter = Router();
const testMessages: RouterChatMessage[] = [
  { role: "user", content: "Respondé exactamente con la palabra OK." },
];

function safeTestError(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (/^Provider returned HTTP \d+\.$/.test(message)) return message;
  if (
    message.startsWith("Gemini necesita imágenes") ||
    message.startsWith("Anthropic image URLs") ||
    message.startsWith("El proveedor")
  ) {
    return message.slice(0, 220);
  }
  return "No se pudo conectar con el proveedor. Revisá su configuración e intentá de nuevo.";
}

async function runProviderTest(
  token: string,
  provider: RouterProviderConfig,
): Promise<{ ok: boolean; latencyMs: number; message: string; testedAt: string }> {
  const startedAt = Date.now();
  let ok = false;
  let message = "No se pudo conectar con el proveedor.";
  try {
    await createProviderCompletion(provider, testMessages, {
      maxTokens: 16,
      jsonMode: false,
    });
    ok = true;
    message = "El proveedor respondió correctamente.";
  } catch (error) {
    message = safeTestError(error);
  }

  const testedAt = new Date().toISOString();
  await recordProviderTestResult(token, provider.id, { ok, testedAt });
  return {
    ok,
    latencyMs: Math.max(0, Date.now() - startedAt),
    message,
    testedAt,
  };
}

router.get("/router/status", requireSupabaseUser, async (req, res): Promise<void> => {
  const token = req.supabaseAccessToken!;
  try {
    const providers = await listProviders(token);
    const active = providers.filter((provider) => provider.isActive);
    const testedAt = active
      .map((provider) => provider.lastTestAt)
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1) ?? null;
    const connected = active.some((provider) => provider.status === "connected");
    const status = GetRouterStatusResponse.safeParse({
      configured: active.length > 0,
      connected,
      lastTestAt: testedAt,
      lastLatencyMs: null,
      message: active.length === 0
        ? "No hay proveedores activos para esta cuenta."
        : connected
          ? null
          : "Todavía no se confirmó una conexión exitosa.",
    });
    if (!status.success) {
      res.status(500).json({ error: "No pude leer el estado de Router IA." });
      return;
    }
    res.json(status.data);
  } catch (error) {
    req.log.error({ err: error }, "Router status lookup failed");
    res.status(502).json({ error: "No pude leer el estado de Router IA." });
  }
});

router.get("/router/providers", requireSupabaseUser, async (req, res): Promise<void> => {
  try {
    const output = ListRouterProvidersResponse.safeParse(
      await listProviders(req.supabaseAccessToken!),
    );
    if (!output.success) {
      res.status(502).json({ error: "Invalid provider response." });
      return;
    }
    res.json(output.data);
  } catch (error) {
    req.log.error({ err: error }, "Provider list failed");
    res.status(502).json({ error: "No pude leer tus proveedores." });
  }
});

router.post("/router/providers", requireSupabaseUser, async (req, res): Promise<void> => {
  const parsed = CreateRouterProviderBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid provider." });
    return;
  }
  try {
    const output = CreateRouterProviderResponse.safeParse(await createProvider(
      req.supabaseAccessToken!,
      req.authenticatedUserId!,
      parsed.data,
    ));
    if (!output.success) {
      res.status(502).json({ error: "Invalid provider response." });
      return;
    }
    res.status(201).json(output.data);
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : "Invalid provider.",
    });
  }
});

router.patch("/router/providers/:id", requireSupabaseUser, async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = UpdateRouterProviderParams.safeParse({ id });
  const parsed = UpdateRouterProviderBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: "Invalid provider." });
    return;
  }
  try {
    const output = UpdateRouterProviderResponse.safeParse(
      await updateProvider(req.supabaseAccessToken!, id, parsed.data),
    );
    if (!output.success) {
      res.status(502).json({ error: "Invalid provider response." });
      return;
    }
    res.json(output.data);
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : "Invalid provider.",
    });
  }
});

router.delete("/router/providers/:id", requireSupabaseUser, async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  if (!DeleteRouterProviderParams.safeParse({ id }).success) {
    res.status(400).json({ error: "Invalid provider id." });
    return;
  }
  try {
    await deleteProvider(req.supabaseAccessToken!, id);
    res.sendStatus(204);
  } catch (error) {
    req.log.error({ err: error }, "Provider delete failed");
    res.status(404).json({ error: "Provider not found." });
  }
});

router.post("/router/providers/:id/test", requireSupabaseUser, async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  if (!TestRouterProviderParams.safeParse({ id }).success) {
    res.status(400).json({ error: "Invalid provider id." });
    return;
  }
  const token = req.supabaseAccessToken!;
  try {
    const provider = await getProviderConfig(token, id);
    if (!provider) {
      res.status(404).json({ error: "Provider not found." });
      return;
    }
    const output = TestRouterProviderResponse.safeParse(
      await runProviderTest(token, provider),
    );
    if (!output.success) {
      res.status(502).json({ error: "Invalid provider response." });
      return;
    }
    res.json(output.data);
  } catch (error) {
    req.log.error({ err: error }, "Provider connection test failed");
    res.status(502).json({
      ok: false,
      latencyMs: null,
      message: safeTestError(error),
    });
  }
});

router.post("/router/test", requireSupabaseUser, async (req, res): Promise<void> => {
  const parsed = TestRouterConnectionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "El tipo de prueba de Router IA no es válido." });
    return;
  }

  const token = req.supabaseAccessToken!;
  try {
    const providers = await listProviders(token);
    const selected = providers.find((provider) => provider.isActive && provider.isDefault) ??
      providers.find((provider) => provider.isActive);
    if (!selected) {
      res.json({
        configured: false,
        connected: false,
        lastTestAt: null,
        lastLatencyMs: null,
        message: "No hay proveedores activos para esta cuenta.",
      });
      return;
    }

    const provider = await getProviderConfig(token, selected.id);
    if (!provider) {
      res.status(404).json({ error: "Provider not found." });
      return;
    }
    const result = await runProviderTest(token, provider);
    const response = TestRouterConnectionResponse.safeParse({
      configured: true,
      connected: result.ok,
      lastTestAt: result.testedAt,
      lastLatencyMs: result.latencyMs,
      message: result.ok ? null : result.message,
    });
    if (!response.success) {
      req.log.error(
        { validationError: response.error.message },
        "Router connection test response did not match the API contract",
      );
      res.status(500).json({ error: "No pude interpretar el resultado del test." });
      return;
    }
    res.json(response.data);
  } catch (error) {
    req.log.error({ err: error }, "Router connection test failed");
    res.status(502).json({ error: "No pude ejecutar el test de Router IA." });
  }
});

export default router;