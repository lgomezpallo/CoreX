import { Router, type IRouter } from "express";
import {
  GetRouterStatusResponse,
  TestRouterConnectionBody,
  TestRouterConnectionResponse,
} from "@workspace/api-zod";
import { getRouterStatus, testRouterConnection } from "../lib/router-client";

const router: IRouter = Router();

router.get("/router/status", (_req, res): void => {
  const parsed = GetRouterStatusResponse.safeParse(getRouterStatus());
  if (!parsed.success) {
    res.status(500).json({ error: "No pude leer el estado de Router IA." });
    return;
  }
  res.json(parsed.data);
});

router.post("/router/test", async (req, res): Promise<void> => {
  const parsed = TestRouterConnectionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "El tipo de prueba de Router IA no es válido." });
    return;
  }

  try {
    const status = await testRouterConnection(parsed.data.task_type);
    const response = TestRouterConnectionResponse.safeParse(status);
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
    req.log.error({ err: error }, "Router connection test failed before it could produce a result");
    res.status(500).json({ error: "No pude ejecutar el test de Router IA." });
  }
});

export default router;