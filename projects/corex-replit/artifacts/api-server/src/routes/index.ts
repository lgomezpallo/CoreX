import { Router, type IRouter } from "express";
import builderRouter from "./builder";
import healthRouter from "./health";
import routerStatusRouter from "./router";

const router: IRouter = Router();

router.use(healthRouter);
router.use(builderRouter);
router.use(routerStatusRouter);

export default router;
