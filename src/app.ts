import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import authRoutes from "./app/routes/authRoutes";
import userRoutes from "./app/routes/userRoutes";
import accountRoutes from "./app/routes/accountRoutes";
import categoryRoutes from "./app/routes/categoryRoutes";
import { errorMiddleware } from "./shared/middlewares";
import { authMiddleware } from "./app/middlewares/authMiddleware";

const app = express();

app.use(helmet());
app.use(cors());
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      error: "TooManyRequests",
      message: "Too many requests, please try again later",
    },
  }),
);
app.use(express.json());

app.get("/", (req, res) => {
  res.status(200).send({ hello: "world!" });
});

app.use("/auth", authRoutes);

app.use(authMiddleware);

app.use("/users", userRoutes);
app.use("/accounts", accountRoutes);
app.use("/categories", categoryRoutes);

app.use(errorMiddleware);

export default app;
