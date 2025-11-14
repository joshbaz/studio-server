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
    testSMSOTP,
    forgotPassword,
    sendVerificationEmail,
    verifyAccount,
    sendPasswordResetEmail,
    resetPassword,
} from '../controllers/userControllers.js';
import { body } from 'express-validator';
import rateLimit from 'express-rate-limit';

import { verifyToken } from '../middleware/verifyToken.js';
import prisma from '@/utils/db.mjs';
import { validateData } from '../middleware/validateBody.mjs';
import {
    forgotPasswordSchema,
    loginUserSchema,
    otpSchema,
    registerUserSchema,
    verifyOtpSchema,
} from '../validationschemas/index.js';

const router = express.Router();

const otpLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    max: 5,
    message:
        'Too many requests from this IP, please try again after 10 minutes',
});

router.post('/register', validateData(registerUserSchema), createUser);
router.post('/sendotp', otpLimiter, validateData(otpSchema), sendOTP);
router.post(
    '/verifyotp',
    otpLimiter,
    // verifyToken,
    validateData(verifyOtpSchema),
    verifyOTP
);
router.post('/login', validateData(loginUserSchema), loginUser);
router.post('/logout/:id', verifyToken, logout);
router.post('/testemail-otp', testEmailOTP);
router.post('/testsms-otp', testSMSOTP);
router.post(
    '/forgot-password',
    verifyToken,
    validateData(forgotPasswordSchema),
    forgotPassword
);
router.post('/send-verification-email', sendVerificationEmail);
router.get('/verify-account', verifyAccount);
router.post('/send-password-reset-email', sendPasswordResetEmail);
router.post('/reset-password', resetPassword);

// GET
router.get('/me/:userId', verifyToken, getUserProfile);
router.get('/find/:id', verifyToken, getUser);
router.get('/findall', verifyToken, getUsers);

// PUT
router.put('/:id', verifyToken, updateUser);

// DELETE
router.delete('/:id', verifyToken, deleteUser);

export default router;
