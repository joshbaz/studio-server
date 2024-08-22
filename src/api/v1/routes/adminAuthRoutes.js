import express from 'express';
import {
   getProfile,
   login,
   logout,
   register,
} from '../controllers/adminAuth.controllers.js';
import { body } from 'express-validator';
import { verifyToken } from '../middleware/verifyToken.js';
import prisma from '@/utils/db.mjs';

const router = express.Router();

// email validation function
const customRegisterFunc = async (value, { res }) => {
   const existingUser = await prisma.admin.findUnique({
      where: {
         email: value,
      },
   });
   if (existingUser) {
      throw new Error('Email already in use');
   }

   return true;
};

router.get('/', (req, res) => {
   res.status(200).json({ message: 'Admin Auth Route' });
});

router.post(
   '/register',
   verifyToken,
   [
      body('email')
         .isEmail()
         .withMessage('Please insert a valid Email')
         .custom(customRegisterFunc)
         .normalizeEmail(),
      body('password')
         .trim()
         .isLength({ min: 6 })
         .withMessage('Please check the passkey char length'),
   ],
   register
);

const customFunc = async (value) => {
   const existingUser = await prisma.admin.findUnique({
      where: {
         email: value,
      },
   });
   if (!existingUser) {
      throw new Error('Invalid credentials');
   }

   return true;
};
router.post(
   '/login',
   [
      body('email')
         .isEmail()
         .withMessage('Please enter a valid email')
         .custom(customFunc)
         .normalizeEmail(),
      body('password')
         .trim()
         .isLength({ min: 6 })
         .withMessage('Invalid credentials'),
   ],
   login
);

router.get('/me/:adminId', verifyToken, getProfile);
// check if cookie tokens are valid
router.post('/verifytoken', verifyToken, (req, res) => {
   res.status(200).json({ message: 'Token is valid' });
});
router.post('/logout/:id', verifyToken, logout);

export default router;
