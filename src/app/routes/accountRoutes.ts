import { Router } from "express";
import { AccountController } from "../controllers/AccountController";

const router = Router();

router.get("/", AccountController.getAllAccounts);
router.post("/", AccountController.createAccount);
router.get("/:id", AccountController.getAccountById);
router.put("/:id", AccountController.updateAccount);

export default router;
