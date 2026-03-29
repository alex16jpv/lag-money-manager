import { DataTypes, Model, Sequelize } from "sequelize";
import { MODEL_NAMES } from "../../shared/constants";

export class CategoryModel extends Model {
  id!: number;
  name!: string;

  static associate() {}
}

export default (sequelize: Sequelize) => {
  CategoryModel.init(
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
    },
    {
      sequelize,
      modelName: MODEL_NAMES.CATEGORY,
    }
  );

  return CategoryModel;
};
