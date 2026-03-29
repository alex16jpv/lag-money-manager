import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import authRoutes from "./app/routes/authRoutes";
import userRoutes from "./app/routes/userRoutes";
import accountRoutes from "./app/routes/accountRoutes";
import categoryRoutes from "./app/routes/categoryRoutes";
import { errorMiddleware } from "./shared/middlewares";
import { ENVIRONMENT } from "./shared/constants";
import { authMiddleware } from "./app/middlewares/authMiddleware";
import logger from "./shared/logger";

const app = express();
const port = ENVIRONMENT.PORT;

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

app.listen(port, () => {
  logger.info(`App listening on port ${port}`);
});
