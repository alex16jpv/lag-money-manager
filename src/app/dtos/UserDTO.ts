export interface CreateUserDTO {
  name: string;
  email: string;
  password: string;
  timezone?: string;
  currency?: string;
}

export interface UpdateUserDTO {
  id?: string;
  name?: string;
  email?: string;
  password?: string;
  // Verification only; never persisted.
  currentPassword?: string;
  timezone?: string;
  currency?: string;
}

export interface UserResponseDTO {
  id: string;
  name: string;
  email: string;
  timezone: string;
  currency: string;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  // Present (true) only when register revived a soft-deleted account.
  reactivated?: boolean;
}
