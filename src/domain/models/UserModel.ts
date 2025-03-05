import { DataTypes, Model, Sequelize } from "sequelize";
import { MODEL_NAMES } from "../../shared/constants";
import { AccountModel } from "./AccountModel";

export class UserModel extends Model {
  id!: number;
  name!: string;
  email!: string;

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
        type: DataTypes.INTEGER,
        autoIncrement: true,
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
    },
    {
      sequelize,
      modelName: MODEL_NAMES.USER,
    }
  );

  return UserModel;
};
