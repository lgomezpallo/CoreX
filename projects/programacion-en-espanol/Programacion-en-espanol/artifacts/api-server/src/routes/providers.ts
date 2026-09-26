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
    res.status(500).json({ error: "No pude leer el estado de los proveedores." });
    return;
  }
  res.json(parsed.data);
});

router.post("/builder/providers/test", async (req, res): Promise<void> => {
  if (process.env.NODE_ENV === "production") {
    res.status(403).json({ error: "Los tests de proveedores solo están disponibles en el Repl de trabajo." });
    return;
  }

  const parsed = TestBuilderProvidersBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Elegí un proveedor válido para probar." });
    return;
  }

  try {
    const results = await testProviders(parsed.data.providerId);
    const response = TestBuilderProvidersResponse.safeParse({ results });
    if (!response.success) {
      req.log.error({ validationError: response.error.message }, "Provider test response did not match the API contract");
      res.status(500).json({ error: "No pude interpretar el resultado del test." });
      return;
    }
    res.json(response.data);
  } catch (error) {
    req.log.error({ err: error }, "Provider test failed before it could produce a result");
    res.status(500).json({ error: "No pude ejecutar el test de proveedores." });
  }
});

export default router;