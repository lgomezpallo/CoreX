import { Router, type IRouter } from "express";
import {
  ListBuilderProvidersResponse,
  TestBuilderProvidersBody,
  TestBuilderProvidersResponse,
} from "@workspace/api-zod";
import { getProviderStatuses, testProviders } from "../lib/llm-providers";

const router: IRouter = Router();

router.get("/builder/providers", (_req, res): void => {
  const parsed = ListBuilderProvidersResponse.safeParse({
    providers: getProviderStatuses(),
    healthLifetime: "server-session",
  });
  if (!parsed.success) {
    res.status(500).json({ error: "No pude leer el estado de Router IA." });
    return;
  }
  res.json(parsed.data);
});

router.post("/builder/providers/test", async (req, res): Promise<void> => {
  const parsed = TestBuilderProvidersBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Elegí Router IA para probar la conexión." });
    return;
  }

  try {
    const results = await testProviders(parsed.data.providerId);
    const response = TestBuilderProvidersResponse.safeParse({ results });
    if (!response.success) {
      req.log.error({ validationError: response.error.message }, "Router IA test response did not match the API contract");
      res.status(500).json({ error: "No pude interpretar el resultado de la prueba de Router IA." });
      return;
    }
    res.json(response.data);
  } catch (error) {
    req.log.error({ err: error }, "Router IA connection test failed");
    res.status(500).json({ error: "No pude ejecutar la prueba de Router IA." });
  }
});

export default router;
