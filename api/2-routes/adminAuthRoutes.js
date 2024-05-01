import express from "express";
import { login, logout, register } from "../1-controllers/adminAuth.controllers.js";
import { body } from "express-validator";
import AdminModel from "../0-models/admin.models.js";
import { verifyToken } from "../4-middleware/verifyToken.js";
const router = express.Router();

router.post(
  "/register",verifyToken,
  [
    body("email")
      .isEmail()
      .withMessage("Please insert a valid Email")
      .custom((value, { req }) => {
        return AdminModel.findOne({ email: value }).then((emails) => {
          if (emails) {
            return Promise.reject("Email already exists!!");
          }
        });
      })
      .normalizeEmail(),
    body("password")
      .trim()
      .isLength({ min: 6 })
      .withMessage("Please check the passkey char length"),
  ],
  register
);
router.post("/login", login);

router.post("/logout", logout);

router.post("/google", login);

export default router;