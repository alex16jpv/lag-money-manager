require("dotenv").config();

module.exports = {
  development: {
    username: process.env.SEQ_USERNAME,
    password: process.env.SEQ_PASSWORD,
    database: process.env.SEQ_DATABASE,
    host: process.env.SEQ_HOST,
    port: Number(process.env.SEQ_PORT) || 3306,
    dialect: "mysql",
  },
  test: {
    username: process.env.SEQ_USERNAME,
    password: process.env.SEQ_PASSWORD,
    database: process.env.SEQ_DATABASE,
    host: process.env.SEQ_HOST,
    port: Number(process.env.SEQ_PORT) || 3306,
    dialect: "mysql",
  },
  production: {
    username: process.env.SEQ_USERNAME,
    password: process.env.SEQ_PASSWORD,
    database: process.env.SEQ_DATABASE,
    host: process.env.SEQ_HOST,
    port: Number(process.env.SEQ_PORT) || 3306,
    dialect: "mysql",
  },
};
