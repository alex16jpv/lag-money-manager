import { User } from "./domain/entities/User";
import { UserSeqRepository } from "./domain/repositories/user/UserSeqRepository";
import { UserController } from "./app/controllers/UserController";
import { RepositoryFactory } from "./app/factories/RepositoryFactory";

try {
  const user = new User({ id: 1, name: "John Doe", email: "email@mail.com" });
  const userRepo = RepositoryFactory.getUserRepository();
  const userSeqRepo = new UserSeqRepository();
  const userController = UserController;

  console.log(user);
  console.log(user.id);

  //   userRepo?.getAll();
  //   userSeqRepo.getAll();
} catch (error) {
  console.log(error);
}
