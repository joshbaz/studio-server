import express from 'express';
import {
   updateUser,
   getUser,
   deleteUser,
   createUser,
   getUsers,
   loginUser,
   logout,
   getUserProfile,
} from '../controllers/userControllers.js';
import { body } from 'express-validator';

import { verifyToken } from '../middleware/verifyToken.js';
import prisma from '@/utils/db.mjs';

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

const customEmailFuncLogin = async (value) => {
   const user = await prisma.user.findUnique({
      where: {
         email: value,
      },
   });

   if (!user) {
      throw new Error('Invalid email or password');
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
router.post(
   '/login',
   [
      body('email')
         .isEmail()
         .withMessage('Please enter a valid email')
         .custom(customEmailFuncLogin),
      body('password').isLength({ min: 6 }),
   ],
   loginUser
);
router.get('/me/:userId', verifyToken, getUserProfile);
router.post('/logout/:id', verifyToken, logout);
router.put('/:id', verifyToken, updateUser);
router.get('/find/:id', verifyToken, getUser);
router.get('/findall', verifyToken, getUsers);
router.delete('/:id', verifyToken, deleteUser);

export default router;
