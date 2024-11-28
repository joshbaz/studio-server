import express from 'express';
import {
    addPaymentMethod,
    deletePaymentMethod,
    getPaymentHistory,
    getPaymentMethods,
    updatePaymentMethod,
} from '../controllers/paymentControllers.js';
import { verifyToken } from '../middleware/verifyToken.js';
import { mtnRouter } from './mtnRouter.js';
import { pesapalRouter } from './pesapalRouter.js';

const router = express.Router();

// SUBROUTES
router.use('/mtn', mtnRouter);
router.use('/pesapal', pesapalRouter);

// POST
router.post('/:userId/newpaymentmethod', verifyToken, addPaymentMethod);
router.get('/mtncallback/:orderTrackingId', (req, res) => {
    const { orderTrackingId } = req.params;

    console.log('MTN callback', req.body);
    if (!orderTrackingId) {
        return res.status(400).send({ message: 'Invalid order tracking ID' });
    }

    return res.status(200).send({ message: 'Payment successful' });
});

// GET
router.get('/:userId/paymentMethods', verifyToken, getPaymentMethods);
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
