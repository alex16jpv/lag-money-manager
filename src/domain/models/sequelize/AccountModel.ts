import { DataTypes, Model, Sequelize } from "sequelize";
import { ACCOUNT_TYPES, MODEL_NAMES } from "../../../shared/constants";
import { UserModel } from "./UserModel";
import { v7 as uuidv7 } from "uuid";

export class AccountModel extends Model {
  id!: string;
  name!: string;
  type!: keyof typeof ACCOUNT_TYPES;
  balance!: number;
  userId!: string;

  static associate() {
    AccountModel.belongsTo(UserModel, {
      foreignKey: "userId",
      as: "user",
      onDelete: "CASCADE",
    });
  }
}

export default (sequelize: Sequelize) => {
  AccountModel.init(
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
      type: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      balance: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: false,
      },
      userId: {
        type: DataTypes.CHAR(36),
        allowNull: false,
      },
    },
    {
      sequelize,
      modelName: MODEL_NAMES.ACCOUNT,
    },
  );

  return AccountModel;
};
