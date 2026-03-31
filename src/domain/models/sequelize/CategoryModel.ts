import { DataTypes, Model, Sequelize } from "sequelize";
import { MODEL_NAMES } from "../../../shared/constants";
import { v7 as uuidv7 } from "uuid";

export class CategoryModel extends Model {
  id!: string;
  name!: string;
  emoji?: string;
  userId!: string;
}

export default (sequelize: Sequelize) => {
  CategoryModel.init(
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
      emoji: {
        type: DataTypes.STRING(8),
        allowNull: true,
      },
      userId: {
        type: DataTypes.CHAR(36),
        allowNull: false,
      },
    },
    {
      sequelize,
      modelName: MODEL_NAMES.CATEGORY,
    },
  );

  return CategoryModel;
};
