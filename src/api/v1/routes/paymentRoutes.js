import express from 'express';
import {
   createSubscription,
   getPaymentMethods,
   getSubscription,
   updateSubscription,
} from '../controllers/paymentControllers.js';
import rateLimit from 'express-rate-limit';
import { verifyToken } from '../middleware/verifyToken.js';

const router = express.Router();

const otpLimiter = rateLimit({
   windowMs: 10 * 60 * 1000,
   max: 5,
   message: 'Too many requests from this IP, please try again after 10 minutes',
});

// POST
router.post('/subscription', verifyToken, otpLimiter, createSubscription);

// GET
router.get('/:userId/paymentMethods', getPaymentMethods);
router.get('/:userId/subscription', verifyToken, getSubscription);

// PUT
router.put('/:userId/subscription', verifyToken, updateSubscription);

export default router;
