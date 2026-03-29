import bcryptjs from "bcryptjs";
import { User } from "../../domain/entities/User";
import { IUserRepository } from "../../domain/repositories/user/IUserRepository";
import { ApiError } from "../../shared/errors";
import { CreateUserDTO, UpdateUserDTO } from "../dtos/UserDTO";

export class UserService {
  constructor(private repo: IUserRepository) {}

  async getAllUsers(): Promise<User[]> {
    return await this.repo.getAll();
  }

  async getUserById(id: string): Promise<User> {
    const user = await this.repo.getById(id);
    if (!user) {
      throw new ApiError("NotFound", "User not found");
    }
    return user;
  }

  async createUser(dto: CreateUserDTO): Promise<User> {
    const user = new User(dto);
    user.validate();

    if (user.password) {
      user.password = await bcryptjs.hash(user.password, 12);
    }

    return await this.repo.create(user);
  }

  async updateUser(id: string, dto: UpdateUserDTO): Promise<User> {
    if (dto.id && id !== dto.id) {
      throw new ApiError("BadRequest", "User id does not match");
    }

    if (dto.password) {
      dto.password = await bcryptjs.hash(dto.password, 12);
    }

    return await this.repo.update(id, dto);
  }

  async deleteUser(id: string): Promise<void> {
    return await this.repo.delete(id);
  }
}
