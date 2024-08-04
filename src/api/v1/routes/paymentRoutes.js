import express from 'express';
import { createSubscription } from '../controllers/paymentControllers.js';
import rateLimit from 'express-rate-limit';
import { verifyToken } from '../middleware/verifyToken.js';
import { validateData } from '../middleware/validateBody.mjs';
import { paymentSchema } from '../validationschemas/index.js';

const router = express.Router();

const otpLimiter = rateLimit({
   windowMs: 10 * 60 * 1000,
   max: 5,
   message: 'Too many requests from this IP, please try again after 10 minutes',
});

router.get('/test', (req, res) => {
   return res.status(200).json({ message: 'Test passed successfully' });
});

router.post('/subscription', verifyToken, otpLimiter, createSubscription);

export default router;
