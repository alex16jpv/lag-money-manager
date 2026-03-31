export interface CreateCategoryDTO {
  name: string;
  emoji?: string;
  userId: string;
}

export interface UpdateCategoryDTO {
  id?: string;
  name?: string;
  emoji?: string;
}
