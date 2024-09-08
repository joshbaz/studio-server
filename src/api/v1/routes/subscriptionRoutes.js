import express from 'express';
import {
   getUserSubscription,
   createSubscription,
   addSubscriptionPlan,
   getSubscriptionPlans,
   updateSubscriptionPlan,
   deleteSubscriptionPlan,
   updateUserSubscription,
   assignSubscriptionPlan,
} from '../controllers/subscription.js';
import rateLimit from 'express-rate-limit';
import { verifyToken } from '../middleware/verifyToken.js';

const router = express.Router();

const otpLimiter = rateLimit({
   windowMs: 10 * 60 * 1000,
   max: 5,
   message: 'Too many requests from this IP, please try again after 10 minutes',
});

// POST
router.post('/:userId/new', verifyToken, otpLimiter, createSubscription);
router.post('/newplan', addSubscriptionPlan);

// GET
router.get('/:userId/plans', getSubscriptionPlans);
router.get('/:userId', verifyToken, getUserSubscription);

// PUT
router.put('/:userId/update', verifyToken, updateUserSubscription);
router.put('/plan/:planId', verifyToken, updateSubscriptionPlan);
router.put('/:userId/assign/:planId', verifyToken, assignSubscriptionPlan);

// DELETE
router.delete('/:planId/delete', verifyToken, deleteSubscriptionPlan);

export default router;
