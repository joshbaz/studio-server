import express from 'express';
import {
   updateUser,
   getUser,
   deleteUser,
   createUser,
} from '../controllers/userControllers.js';
import { body } from 'express-validator';

import { verifyToken } from '../middleware/verifyToken.js';
import prisma from '../../../utils/db.mjs';

const router = express.Router();

const customEmailFunc = async (value) => {
   const user = await prisma.user.findUnique({
      where: {
         email: value,
      },
   });

   if (user) {
      throw new Error('This email is already in use');
   }
};

router.post(
   '/register',
   [
      body('email')
         .isEmail()
         .withMessage('Please enter a valid email')
         .custom(customEmailFunc),
   ],
   createUser
);
router.put('/:id', verifyToken, updateUser);
router.get('/find/:id', verifyToken, getUser);
router.delete('/:id', verifyToken, deleteUser);

export default router;
