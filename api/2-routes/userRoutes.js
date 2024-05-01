import express from "express";
import {
  updateUser,
  getUser,
  deleteUser,
} from "../1-controllers/userControllers.js";

import { verifyToken } from "../4-middleware/verifyToken.js";
const router = express.Router();

router.put("/:id", verifyToken, updateUser);
router.get("/find/:id", verifyToken, getUser);
router.delete("/:id", verifyToken, deleteUser);

export default router;
