import { DataTypes, Model, Sequelize } from "sequelize";
import { MODEL_NAMES } from "../../../shared/constants";
import { AccountModel } from "./AccountModel";
import { v7 as uuidv7 } from "uuid";

export class UserModel extends Model {
  id!: string;
  name!: string;
  email!: string;
  password!: string;
  createdAt!: Date;
  updatedAt!: Date;

  static associate() {
    UserModel.hasMany(AccountModel, {
      foreignKey: "userId",
      as: "accounts",
    });
  }
}

export default (sequelize: Sequelize) => {
  UserModel.init(
    {
      id: {
        type: DataTypes.CHAR(36),
        defaultValue: () => uuidv7(),
        primaryKey: true,
      },
      name: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      email: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
      },
      password: {
        type: DataTypes.STRING,
        allowNull: false,
      },
    },
    {
      sequelize,
      modelName: MODEL_NAMES.USER,
    },
  );

  return UserModel;
};
