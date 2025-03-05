import { Sequelize } from "sequelize";
import { ENVIRONMENT } from "../shared/constants";
const { SEQ_HOST, SEQ_DATABASE, SEQ_USERNAME, SEQ_PASSWORD } = ENVIRONMENT;

const sequelize = new Sequelize({
  username: SEQ_USERNAME,
  password: SEQ_PASSWORD,
  database: SEQ_DATABASE,
  host: SEQ_HOST,
  dialect: "mysql",
  logging: false,
});

export default sequelize;
