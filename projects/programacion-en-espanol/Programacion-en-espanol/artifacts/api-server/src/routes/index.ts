import { Router, type IRouter } from "express";
import builderRouter from "./builder";
import healthRouter from "./health";
import providersRouter from "./providers";

const router: IRouter = Router();

router.use(healthRouter);
router.use(builderRouter);
router.use(providersRouter);

export default router;
