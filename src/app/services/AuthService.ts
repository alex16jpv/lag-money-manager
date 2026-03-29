import bcryptjs from "bcryptjs";
import jwt from "jsonwebtoken";
import { ENVIRONMENT } from "../../shared/constants";
import { IUserRepository } from "../../domain/repositories/user/IUserRepository";
import { User } from "../../domain/entities/User";
import { ApiError } from "../../shared/errors";
import { CreateUserDTO, UserResponseDTO } from "../dtos/UserDTO";

export class AuthService {
  constructor(private repo: IUserRepository) {}

  async register(dto: CreateUserDTO): Promise<UserResponseDTO> {
    const hashedPassword = await bcryptjs.hash(dto.password, 12);
    const user = new User({ ...dto, password: hashedPassword });
    user.validate();

    const created = await this.repo.create(user);
    const { password: _, ...userWithoutPassword } = created as User & {
      password?: string;
    };
    return userWithoutPassword as UserResponseDTO;
  }

  async login(
    email: string,
    password: string,
  ): Promise<{ token: string; user: UserResponseDTO }> {
    const user = await this.repo.getByEmail(email);
    if (!user) {
      throw new ApiError("Unauthorized", "Invalid email or password");
    }

    const isValidPassword = await bcryptjs.compare(
      password,
      (user as User & { password: string }).password,
    );
    if (!isValidPassword) {
      throw new ApiError("Unauthorized", "Invalid email or password");
    }

    const token = jwt.sign(
      { userId: user.id, email: user.email },
      ENVIRONMENT.JWT_SECRET,
      { expiresIn: "24h" },
    );

    const { password: _, ...userWithoutPassword } = user as User & {
      password?: string;
    };
    return { token, user: userWithoutPassword as UserResponseDTO };
  }
}
