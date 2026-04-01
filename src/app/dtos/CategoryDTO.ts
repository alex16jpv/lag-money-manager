import { CategoryType, Color } from "../../shared/constants";

export interface CreateCategoryDTO {
  name: string;
  emoji?: string;
  color?: Color;
  type?: CategoryType;
  userId: string;
}

export interface UpdateCategoryDTO {
  id?: string;
  name?: string;
  emoji?: string;
  color?: Color;
  type?: CategoryType;
}
