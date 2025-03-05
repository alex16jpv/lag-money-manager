import { DataTypes, Model, Sequelize } from "sequelize";
import { MODEL_NAMES } from "../../shared/constants";

export class UserModel extends Model {
  id!: number;
  name!: string;
  email!: string;
}

export const userModelInit = (sequelize: Sequelize) => {
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

  UserModel.sync({ force: false });

  return UserModel;
};
