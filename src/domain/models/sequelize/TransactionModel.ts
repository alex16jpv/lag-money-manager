import { DataTypes, Model, Sequelize } from "sequelize";
import { MODEL_NAMES, TRANSACTION_TYPES } from "../../../shared/constants";
import { CategoryModel } from "./CategoryModel";
import { AccountModel } from "./AccountModel";
import { UserModel } from "./UserModel";
import { v7 as uuidv7 } from "uuid";

export class TransactionModel extends Model {
  id!: string;
  type!: keyof typeof TRANSACTION_TYPES;
  amount!: number;
  date!: Date;
  categoryId?: string;
  description?: string;
  fromAccountId?: string;
  toAccountId?: string;
  userId!: string;
  tags?: string;
  note?: string;

  static associate() {
    TransactionModel.belongsTo(CategoryModel, {
      foreignKey: "categoryId",
      as: "category",
    });
    TransactionModel.belongsTo(AccountModel, {
      foreignKey: "fromAccountId",
      as: "fromAccount",
    });
    TransactionModel.belongsTo(AccountModel, {
      foreignKey: "toAccountId",
      as: "toAccount",
    });
    TransactionModel.belongsTo(UserModel, {
      foreignKey: "userId",
      as: "user",
    });
  }
}

export default (sequelize: Sequelize) => {
  TransactionModel.init(
    {
      id: {
        type: DataTypes.CHAR(36),
        defaultValue: () => uuidv7(),
        primaryKey: true,
      },
      type: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      amount: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: false,
      },
      date: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      categoryId: {
        type: DataTypes.CHAR(36),
      },
      description: {
        type: DataTypes.STRING,
      },
      fromAccountId: {
        type: DataTypes.CHAR(36),
      },
      toAccountId: {
        type: DataTypes.CHAR(36),
      },
      userId: {
        type: DataTypes.CHAR(36),
        allowNull: false,
      },
      tags: {
        type: DataTypes.STRING(500),
      },
      note: {
        type: DataTypes.STRING(1000),
      },
    },
    {
      sequelize,
      modelName: MODEL_NAMES.TRANSACTION,
    },
  );

  return TransactionModel;
};
