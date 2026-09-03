import { CategoryType, Color } from "../../shared/constants";
import { CategoryIcon } from "../../shared/icons";

export interface CreateCategoryDTO {
  name: string;
  icon?: CategoryIcon;
  color?: Color;
  type?: CategoryType;
  userId: string;
}

export interface UpdateCategoryDTO {
  id?: string;
  name?: string;
  icon?: CategoryIcon;
  color?: Color;
  type?: CategoryType;
}
