import bcryptjs from "bcryptjs";
import jwt from "jsonwebtoken";
import { ENVIRONMENT } from "../../shared/constants";
import { IUserRepository } from "../../domain/repositories/user/IUserRepository";
import { User } from "../../domain/entities/User";
import { ApiError } from "../../shared/errors";

export class AuthService {
  constructor(private repo: IUserRepository) {}

  async register(data: {
    name: string;
    email: string;
    password: string;
  }): Promise<Omit<User, "password">> {
    const hashedPassword = await bcryptjs.hash(data.password, 12);
    const user = new User({ ...data, password: hashedPassword });
    user.validate();

    const created = await this.repo.create(user);
    const { password: _, ...userWithoutPassword } = created as User & {
      password?: string;
    };
    return userWithoutPassword as User;
  }

  async login(
    email: string,
    password: string,
  ): Promise<{ token: string; user: Omit<User, "password"> }> {
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
    return { token, user: userWithoutPassword as User };
  }
}
