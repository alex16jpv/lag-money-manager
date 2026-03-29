export interface CreateCategoryDTO {
  name: string;
  userId: string;
}

export interface UpdateCategoryDTO {
  id?: string;
  name?: string;
}
