import compression from "compression";
import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import swaggerUi from "swagger-ui-express";

import { authMiddleware } from "./app/middlewares/authMiddleware";
import { dbReadinessMiddleware } from "./app/middlewares/dbReadinessMiddleware";
import { gatewaySecretMiddleware } from "./app/middlewares/gatewaySecretMiddleware";
import { requestLogMiddleware } from "./app/middlewares/requestLogMiddleware";
import accountRoutes from "./app/routes/accountRoutes";
import authRoutes from "./app/routes/authRoutes";
import budgetRoutes from "./app/routes/budgetRoutes";
import categoryRoutes from "./app/routes/categoryRoutes";
import statsRoutes from "./app/routes/statsRoutes";
import transactionRoutes from "./app/routes/transactionRoutes";
import userRoutes from "./app/routes/userRoutes";
import { pingDatabase } from "./config/dbHealth";
import { swaggerSpec } from "./config/swagger";
import { ENVIRONMENT } from "./shared/constants";
import { errorMiddleware } from "./shared/middlewares";
import { requestIdMiddleware } from "./shared/requestId";

const app = express();

// In production, enforce HTTPS via redirect
if (ENVIRONMENT.NODE_ENV === "production") {
  app.set("trust proxy", 1);
  app.use((req, res, next) => {
    if (req.secure || req.headers["x-forwarded-proto"] === "https") {
      next();
    } else {
      res.redirect(301, `https://${req.headers.host}${req.url}`);
    }
  });
}

app.use(requestIdMiddleware);
app.use(requestLogMiddleware);
app.use(helmet());
app.use(compression());
app.use(
  cors({
    origin: ENVIRONMENT.CORS_ORIGIN.split(",").map((s) => s.trim()),
  }),
);
app.use(express.json({ limit: "10kb" }));

if (ENVIRONMENT.NODE_ENV !== "production") {
  app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));
}

// All routes below require the gateway secret header
app.use(gatewaySecretMiddleware);

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: ENVIRONMENT.RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "TooManyRequests",
    message: "Too many requests, please try again later",
  },
});

app.get("/", apiLimiter, (_req, res) => {
  res.status(200).send({ hello: "world!" });
});

app.get("/health/db", apiLimiter, async (_req, res) => {
  await pingDatabase();
  res.status(200).json({ database: "ok" });
});

app.use(dbReadinessMiddleware);

app.use("/auth", apiLimiter, authRoutes);

app.use(authMiddleware);

app.use("/users", apiLimiter, userRoutes);
app.use("/accounts", apiLimiter, accountRoutes);
app.use("/categories", apiLimiter, categoryRoutes);
app.use("/transactions", apiLimiter, transactionRoutes);
app.use("/budgets", apiLimiter, budgetRoutes);
app.use("/stats", apiLimiter, statsRoutes);

app.use(errorMiddleware);

export default app;
