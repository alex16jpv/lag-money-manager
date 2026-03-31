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
import { ENVIRONMENT } from "./shared/constants";

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
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "TooManyRequests",
    message: "Too many requests, please try again later",
  },
});
app.use(express.json({ limit: "10kb" }));

app.get("/", (_req, res) => {
  res.status(200).send({ hello: "world!" });
});

app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

app.use("/auth", apiLimiter, authRoutes);

app.use(authMiddleware);

app.use("/users", apiLimiter, userRoutes);
app.use("/accounts", apiLimiter, accountRoutes);
app.use("/categories", apiLimiter, categoryRoutes);
app.use("/transactions", apiLimiter, transactionRoutes);

app.use(errorMiddleware);

export default app;
