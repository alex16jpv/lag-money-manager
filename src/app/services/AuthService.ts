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
    const hashedPassword = await bcryptjs.hash(
      dto.password,
      ENVIRONMENT.BCRYPT_SALT_ROUNDS,
    );
    const user = new User({ ...dto, password: hashedPassword });

    const created = await this.repo.create(user);
    const { password: _, ...userWithoutPassword } = created;
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

    if (!user.password) {
      throw new ApiError("Unauthorized", "Invalid email or password");
    }

    const isValidPassword = await bcryptjs.compare(password, user.password);
    if (!isValidPassword) {
      throw new ApiError("Unauthorized", "Invalid email or password");
    }

    const token = jwt.sign(
      { userId: user.id, email: user.email },
      ENVIRONMENT.JWT_SECRET,
      {
        algorithm: "HS256",
        expiresIn: ENVIRONMENT.JWT_EXPIRATION as jwt.SignOptions["expiresIn"],
      },
    );

    const { password: _, ...userWithoutPassword } = user;
    return { token, user: userWithoutPassword as UserResponseDTO };
  }
}
