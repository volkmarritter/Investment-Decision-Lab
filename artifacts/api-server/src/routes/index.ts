import { Router, type IRouter } from "express";
import healthRouter from "./health";
import adminRouter from "./admin";
import etfPreviewRouter from "./etf-preview";

const router: IRouter = Router();

router.use(healthRouter);
// Public ETF preview is mounted BEFORE the admin router so the
// unauthenticated path is matched without falling through requireAdmin.
router.use(etfPreviewRouter);
router.use(adminRouter);

export default router;
