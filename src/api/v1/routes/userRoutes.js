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
   sendOTP,
   verifyOTP,
   testEmailOTP,
} from '../controllers/userControllers.js';
import { body } from 'express-validator';
import rateLimit from 'express-rate-limit';

import { verifyToken } from '../middleware/verifyToken.js';
import prisma from '@/utils/db.mjs';

const router = express.Router();

const customEmailFunc = async (value, req) => {
   const user = await prisma.user.findUnique({
      where: {
         email: value,
      },
   });

   if (user) {
      throw new Error('Something went wrong. Please try again');
   }
};

const customPhoneNumberFunc = async (value) => {
   const user = await prisma.user.findUnique({
      where: {
         phoneNumber: value,
      },
   });

   if (user) {
      return res.status(400).json({ message: 'Something went wrong' });
   }
};

const customEmailFuncLogin = async (value, _, res) => {
   const user = await prisma.user.findUnique({
      where: {
         email: value.email,
      },
   });

   if (!user) {
      return res
         .status(400)
         .json({ message: 'Something went wrong, while logging in' });
   }
};

router.post(
   '/register',
   // [
   //    body('email')
   //       .isEmpty()
   //       .isEmail()
   //       .withMessage('Please enter a valid email or phone number')
   //       .custom(customEmailFunc),
   //    body('phoneNumber')
   //       .isEmpty()
   //       .isMobilePhone(['en-UG', 'en-KE'])
   //       .withMessage('Please enter a valid email or phone number')
   //       .custom(customPhoneNumberFunc),
   // ],
   createUser
);
const otpLimiter = rateLimit({
   windowMs: 10 * 60 * 1000,
   max: 5,
   message: 'Too many requests from this IP, please try again after 10 minutes',
});
router.post('/sendotp', otpLimiter, sendOTP);
router.post('/verifyotp', otpLimiter, verifyOTP);
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
router.post('/logout/:id', verifyToken, logout);
router.post('/testemail-otp', testEmailOTP);

// GET
router.get('/me/:userId', verifyToken, getUserProfile);
router.get('/find/:id', verifyToken, getUser);
router.get('/findall', verifyToken, getUsers);

// PUT
router.put('/:id', verifyToken, updateUser);

// DELETE
router.delete('/:id', verifyToken, deleteUser);

export default router;
