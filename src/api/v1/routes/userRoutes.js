import express from 'express';
import {
   updateUser,
   getUser,
   deleteUser,
} from '../controllers/userControllers.js';

import { verifyToken } from '../v1/4-middleware/verifyToken.js';
const router = express.Router();

router.put('/:id', verifyToken, updateUser);
router.get('/find/:id', verifyToken, getUser);
router.delete('/:id', verifyToken, deleteUser);

export default router;
