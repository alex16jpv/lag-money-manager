import express from "express";
import userRoutes from "./infra/routes/userRoutes";
const app = express();
const port = 3000;

app.use(express.json());

app.get("/", (req, res) => {
  res.status(200).send({ hello: "world!" });
});

app.use("/users", userRoutes);

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
