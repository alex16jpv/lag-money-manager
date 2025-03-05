import { DataTypes, Model, Sequelize } from "sequelize";
import { MODEL_NAMES, TRANSACTION_TYPES } from "../../shared/constants";
import { CategoryModel } from "./Category";
import { AccountModel } from "./AccountModel";

export class TransactionModel extends Model {
  id!: number;
  type!: keyof typeof TRANSACTION_TYPES;
  amount!: number;
  date!: Date;
  idCategory?: number;
  description?: string;
  fromAccountId?: number;
  toAccountId?: number;
  userId!: number;

  static associate() {
    TransactionModel.belongsTo(CategoryModel, {
      foreignKey: "idCategory",
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
  }
}

export default (sequelize: Sequelize) => {
  TransactionModel.init(
    {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
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
      idCategory: {
        type: DataTypes.INTEGER,
      },
      description: {
        type: DataTypes.STRING,
      },
      fromAccountId: {
        type: DataTypes.INTEGER,
      },
      toAccountId: {
        type: DataTypes.INTEGER,
      },
      userId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
    },
    {
      sequelize,
      modelName: MODEL_NAMES.TRANSACTION,
    }
  );

  return TransactionModel;
};
