import { Sequelize } from "sequelize";
import { ENVIRONMENT } from "../shared/constants";

const env = ENVIRONMENT as {
  SEQ_HOST: string;
  SEQ_DATABASE: string;
  SEQ_USERNAME: string;
  SEQ_PASSWORD: string;
};

const sequelize = new Sequelize({
  username: env.SEQ_USERNAME,
  password: env.SEQ_PASSWORD,
  database: env.SEQ_DATABASE,
  host: env.SEQ_HOST,
  dialect: "mysql",
  logging: false,
});

export default sequelize;
