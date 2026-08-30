import express from "express";
import compression from "compression";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import swaggerUi from "swagger-ui-express";
import { swaggerSpec } from "./config/swagger";
import authRoutes from "./app/routes/authRoutes";
import userRoutes from "./app/routes/userRoutes";
import accountRoutes from "./app/routes/accountRoutes";
import categoryRoutes from "./app/routes/categoryRoutes";
import transactionRoutes from "./app/routes/transactionRoutes";
import { errorMiddleware } from "./shared/middlewares";
import { requestIdMiddleware } from "./shared/requestId";
import { authMiddleware } from "./app/middlewares/authMiddleware";
import { dbReadinessMiddleware } from "./app/middlewares/dbReadinessMiddleware";
import { ENVIRONMENT } from "./shared/constants";
import { gatewaySecretMiddleware } from "./app/middlewares/gatewaySecretMiddleware";
import { pingDatabase } from "./config/dbHealth";

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
app.use(helmet());
app.use(compression());
app.use(
  cors({
    origin: ENVIRONMENT.CORS_ORIGIN.split(",").map((s) => s.trim()),
  }),
);
app.use(express.json({ limit: "10kb" }));

app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

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

app.use(errorMiddleware);

export default app;
