import express from 'express';
import {
   addPaymentMethod,
   deletePaymentMethod,
   getPaymentHistory,
   getPaymentMethods,
   updatePaymentMethod,
} from '../controllers/paymentControllers.js';
import { verifyToken } from '../middleware/verifyToken.js';

const router = express.Router();

// POST
router.post('/:userId/newpaymentmethod', verifyToken, addPaymentMethod);

// GET
router.get('/:userId/paymentMethods', getPaymentMethods);

router.get('/:userId/history', verifyToken, getPaymentHistory);

// PUT
router.put('/:userId/updateMethod/:methodId', verifyToken, updatePaymentMethod);

// DELETE
router.delete(
   '/:userId/paymentMethod/:methodId',
   verifyToken,
   deletePaymentMethod
);

export default router;
