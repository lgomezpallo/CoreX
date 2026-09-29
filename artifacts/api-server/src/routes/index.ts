import { Router, type IRouter } from "express";
import builderRouter from "./builder";
import generatedProjectsRouter from "./generated-projects";
import labRouter from "./lab";
import healthRouter from "./health";
import routerStatusRouter from "./router";

const router: IRouter = Router();

router.use(healthRouter);
router.use(builderRouter);
router.use(generatedProjectsRouter);
router.use(labRouter);
router.use(routerStatusRouter);

export default router;
