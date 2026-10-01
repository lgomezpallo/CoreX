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
} from "@workspace/api-zod";
import { getRouterStatus, testRouterConnection } from "../lib/router-client";
import {
  createProvider,
  deleteProvider,
  listProviders,
  updateProvider,
} from "../lib/router-providers";
import { requireSupabaseUser } from "../lib/supabase-auth";

const router: IRouter = Router();

router.get("/router/status", requireSupabaseUser, async (req, res): Promise<void> => {
  try {
    const status = GetRouterStatusResponse.safeParse(getRouterStatus());
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
  res.status(410).json({
    error: "CoreX ya no prueba providers directamente; todas las inferencias pasan por Router IA.",
  });
});

router.post("/router/test", requireSupabaseUser, async (req, res): Promise<void> => {
  const parsed = TestRouterConnectionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "El tipo de prueba de Router IA no es válido." });
    return;
  }

  try {
    const response = TestRouterConnectionResponse.safeParse(
      await testRouterConnection(parsed.data.task_type),
    );
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
    res.status(502).json({ error: "No pude comprobar la disponibilidad de Router IA." });
  }
});

export default router;