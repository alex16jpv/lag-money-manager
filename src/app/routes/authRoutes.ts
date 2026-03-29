import { Router } from "express";
import { AuthController } from "../controllers/AuthController";
import { validate } from "../validation/validate";
import { registerSchema, loginSchema } from "../validation/schemas";

const router = Router();

router.post("/register", validate(registerSchema), AuthController.register);
router.post("/login", validate(loginSchema), AuthController.login);

export default router;
