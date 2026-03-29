import { DataTypes, Model, Sequelize } from "sequelize";
import { MODEL_NAMES } from "../../../shared/constants";
import { v7 as uuidv7 } from "uuid";

export class CategoryModel extends Model {
  id!: string;
  name!: string;

  static associate() {}
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
    },
    {
      sequelize,
      modelName: MODEL_NAMES.CATEGORY,
    },
  );

  return CategoryModel;
};
