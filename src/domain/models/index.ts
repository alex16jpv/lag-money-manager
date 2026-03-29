import * as models from "./models";
import sequelize from "../../config/sequelizeConnection";
import { Model, ModelStatic } from "sequelize";

interface AssociableModel extends ModelStatic<Model> {
  associate(): void;
}

export const loadSequelizeModels = () => {
  const dbModels: Record<string, ModelStatic<Model>> = {};

  Object.entries(models).forEach(([key, model]) => {
    dbModels[key] = model(sequelize);
  });

  for (const key in dbModels) {
    const model = sequelize?.models?.[key] as AssociableModel;
    if (model?.associate) {
      model.associate();
    }
  }

  // sequelize.sync();
};
