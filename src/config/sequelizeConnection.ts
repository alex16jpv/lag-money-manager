import { Sequelize } from "sequelize";
import { ENVIRONMENT } from "../shared/constants";

const env = ENVIRONMENT as {
  SEQ_HOST: string;
  SEQ_DATABASE: string;
  SEQ_USERNAME: string;
  SEQ_PASSWORD: string;
  SEQ_POOL_MAX: number;
  SEQ_POOL_MIN: number;
  SEQ_POOL_ACQUIRE: number;
  SEQ_POOL_IDLE: number;
};

const sequelize = new Sequelize({
  username: env.SEQ_USERNAME,
  password: env.SEQ_PASSWORD,
  database: env.SEQ_DATABASE,
  host: env.SEQ_HOST,
  dialect: "mysql",
  logging: false,
  pool: {
    max: env.SEQ_POOL_MAX,
    min: env.SEQ_POOL_MIN,
    acquire: env.SEQ_POOL_ACQUIRE,
    idle: env.SEQ_POOL_IDLE,
  },
});

export default sequelize;
