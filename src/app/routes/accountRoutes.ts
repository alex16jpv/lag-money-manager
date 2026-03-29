import { Router } from "express";
import { AccountController } from "../controllers/AccountController";
import { validate } from "../validation/validate";
import {
  createAccountSchema,
  updateAccountSchema,
  idParamSchema,
} from "../validation/schemas";

const router = Router();

router.get("/", AccountController.getAllAccounts);
router.post(
  "/",
  validate(createAccountSchema),
  AccountController.createAccount,
);
router.get("/:id", validate(idParamSchema), AccountController.getAccountById);
router.put(
  "/:id",
  validate(updateAccountSchema),
  AccountController.updateAccount,
);
router.delete("/:id", validate(idParamSchema), AccountController.deleteAccount);

export default router;
