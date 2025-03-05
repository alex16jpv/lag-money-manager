import "dotenv/config";
import express from "express";
import userRoutes from "./app/routes/userRoutes";
import { errorMiddleware } from "./shared/middlewares";
import { ENVIRONMENT } from "./shared/constants";
const app = express();
const port = ENVIRONMENT.PORT;

app.use(express.json());

app.get("/", (req, res) => {
  res.status(200).send({ hello: "world!" });
});

app.use("/users", userRoutes);

app.use(errorMiddleware);

app.listen(port, () => {
  console.log(`App listening on port ${port}`);
});
