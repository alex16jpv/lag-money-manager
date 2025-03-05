import { DataTypes, Model, Sequelize } from "sequelize";
import { MODEL_NAMES } from "../../shared/constants";
import { UserModel } from "./UserModel";

export const ACCOUNT_TYPES = {
  CASH: "CASH",
  ACCOUNT: "ACCOUNT",
  CARD: "CARD",
  DEBIT_CARD: "DEBIT_CARD",
  SAVINGS: "SAVINGS",
  INVESTMENT: "INVESTMENT",
  OVERDRAFT: "OVERDRAFT",
  LOAN: "LOAN",
  OTHER: "OTHER",
};

export class AccountModel extends Model {
  id!: number;
  name!: string;
  type!: keyof typeof ACCOUNT_TYPES;
  balance!: number;
  userId!: number;

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
        type: DataTypes.INTEGER,
        autoIncrement: true,
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
        type: DataTypes.INTEGER,
        allowNull: false,
      },
    },
    {
      sequelize,
      modelName: MODEL_NAMES.ACCOUNT,
    }
  );

  return AccountModel;
};
