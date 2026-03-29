import { Router } from "express";
import { UserController } from "../controllers/UserController";
import { validate } from "../validation/validate";
import {
  createUserSchema,
  updateUserSchema,
  idParamSchema,
} from "../validation/schemas";

const router = Router();

router.get("/", UserController.getAllUsers);
router.post("/", validate(createUserSchema), UserController.createUser);
router.get("/:id", validate(idParamSchema), UserController.getUserById);
router.put("/:id", validate(updateUserSchema), UserController.updateUser);
router.delete("/:id", validate(idParamSchema), UserController.deleteUser);

export default router;
