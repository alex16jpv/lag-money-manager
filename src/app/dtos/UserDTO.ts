export interface CreateUserDTO {
  name: string;
  email: string;
  password: string;
  timezone?: string;
}

export interface UpdateUserDTO {
  id?: string;
  name?: string;
  email?: string;
  password?: string;
  timezone?: string;
}

export interface UserResponseDTO {
  id: string;
  name: string;
  email: string;
  timezone: string;
  createdAt: Date;
  updatedAt: Date;
}
