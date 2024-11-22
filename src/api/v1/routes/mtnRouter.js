import express from 'express';
import { generateMTNAuthTk } from '../middleware/generateMTNAuthTK.js';
import {
    mtnPaymentRequest,
    checkPaymentStatus,
} from '@/services/mtnpayments.js';
import prisma from '@/utils/db.mjs';
import { returnError } from '@/utils/returnError.js';
import { env } from '@/env.mjs';

const router = express.Router();

const isProduction = env.NODE_ENV === 'production';
const SITE_URL = env.NYATI_PAYMENTS_API_URL;

// Website Transactions
router.post('/donate', generateMTNAuthTk, async (req, res, next) => {
    try {
        if (!req.body.paymentType === 'MTN') {
            returnError('Payment type not supported', 400);
        }

        const currency = isProduction ? 'UGX' : 'EUR';
        const { orderTrackingId, res } = await mtnPaymentRequest({
            token: req.mtn_access_token,
            amount: req.body.amount,
            currency: currency,
            phoneNumber: req.body.phonenumber,
            paymentMessage: `Donation for Nyati`,
            payeeNote: '',
            callbackURL: isProduction
                ? `${SITE_URL}/mtn/callback/web`
                : undefined,
        });

        if (orderTrackingId) {
            await prisma.webDonation.create({
                data: {
                    transactionType: 'donation',
                    paymentType: 'MTN-MoMo',
                    amount: req.body.amount,
                    purpose: req.body.note,
                    currency: currency,
                    email: req.body.email,
                    phonenumber: req.body.phonenumber,
                    fistname: req.body.firstname,
                    lastname: req.body.lastname,
                    orderTrackingId: orderTrackingId,
                    payment_status_description: 'pending',
                },
            });
        }

        res.status(200).json({
            orderTrackingId,
        });
    } catch (error) {
        console.log('Error', error);
        if (!error.statusCode) {
            error.statusCode = 500;
        }
        next(error);
    }
});

//check status of payment
router.get(
    '/transact_statuses/:id',
    generateMTNAuthTk,
    async (req, res, next) => {
        try {
            const orderTrackingId = req.params.id;
            const getTransact = await prisma.webDonation.findFirst({
                where: { orderTrackingId },
            });

            if (!getTransact.id) returnError('Transaction not found', 404);

            const { status } = await checkPaymentStatus({
                trackingId: orderTrackingId,
                token: req.mtn_access_token,
            });

            //check if transaction status same as the saved one in the db
            if (status !== getTransact.payment_status_description) {
                const updatedTransaction = await prisma.webDonation.update({
                    where: { id: getTransact.id },
                    data: {
                        payment_status_description: transactStatus,
                        status_reason: transactStatus,
                        transactionId:
                            submitStatusRequest.data.financialTransactionId,
                    },
                });

                res.status(200).json({
                    transactionId: updatedTransaction.transactionId,
                    payStatus: updatedTransaction.payment_status_description,
                    status_reason: updatedTransaction.status_reason,
                });
            } else {
                res.status(200).json({
                    payStatus: transactStatus,
                    status_reason: transactStatus,
                });
            }
        } catch (error) {
            if (!error.statusCode) {
                error.statusCode = 500;
            }
            next(error);
        }
    }
);

//check transaction details on successful processing
router.get('/checkStatus', async (req, res, next) => {
    try {
        const { OrderTrackingId } = req.query;
        const transaction = await prisma.webDonation.findFirst({
            where: { orderTrackingId: OrderTrackingId },
        });

        if (!transaction.id) {
            returnError('Transaction not found', 404);
        }

        res.status(200).json({
            payStatus: transaction.payment_status_description,
            paidAmount: transaction.amount,
            paymentType: transaction.paymentType,
            transactionId: transaction.transactionId,
            currency: transaction.currency,
            orderTrackingId: OrderTrackingId,
        });
    } catch (error) {
        if (!error.statusCode) {
            error.statusCode = 500;
        }
        next(error);
    }
});

/** APP TRANSACTIONS **/

// app donations
/**
 * Pass Request Needs:
 *  amount
 * phonenumber
 * filmName
 *
 */
router.post('/app/donate', generateMTNAuthTk, async (req, res, next) => {
    try {
        if (!req.body.paymentType) {
            returnError('Payment Type not selected', 400);
        }

        if (req.body.paymentType !== 'MTN') {
            returnError('Payment type not supported', 400);
        }

        const currency = isProduction ? 'UGX' : 'EUR';

        /**
            All Statuses Expected & testCases:
            Failed - 46733123450
            Rejected - 46733123451
            Timeout - 46733123452
            Success - 56733123453
            Pending - 46733123454
            */

        const { status, orderTrackingId } = await mtnPaymentRequest({
            token: req.mtn_access_token,
            amount: req.body.amount,
            currency: currency,
            phoneNumber: req.body.phoneNumber,
            paymentMessage: `Donation for film ${req.body.filmName}`,
            payeeNote: '',
            callbackURL: isProduction
                ? `${SITE_URL}/mtn/app/callback`
                : undefined,
        });

        res.status(200).json({
            status,
            orderTrackingId,
        });
    } catch (error) {
        if (!error.statusCode) {
            error.statusCode = 500;
        }
        next(error);
    }
});

// movie app purchase
/**
 * Pass Request Needs:
 *  amount
 * phonenumber
 * filmName
 *
 */
router.post('/app/purchase', generateMTNAuthTk, async (req, res, next) => {
    try {
        if (!req.body.paymentType) {
            returnError('Payment Type not selected', 400);
        }

        if (req.body.paymentType !== 'MTN') {
            returnError('Payment type not supported', 400);
        }

        // const MTNRequestLink = `${MOMO_BASE_URL}/collection/v1_0/requesttopay`;
        const currency = isProduction ? 'UGX' : 'EUR';

        /**
            All Statuses Expected & testCases:
            Failed - 46733123450
            Rejected - 46733123451
            Timeout - 46733123452
            Success - 56733123453
            Pending - 46733123454

        */

        const { status, orderTrackingId } = await mtnPaymentRequest({
            token: req.mtn_access_token,
            amount: req.body.amount,
            currency: currency,
            phoneNumber: req.body.phoneNumber,
            paymentMessage: `Purchase for film ${req.body.filmName}`,
            payeeNote: '',
            callbackURL: isProduction
                ? `${SITE_URL}/mtn/app/callback`
                : undefined,
        });

        if (!status === 'Accepted' || !orderTrackingId) {
            returnError('Payment request failed', 500);
        }

        res.status(200).json({
            status,
            orderTrackingId,
        });
    } catch (error) {
        if (!error.statusCode) {
            error.statusCode = 500;
        }
        next(error);
    }
});

router.put('/callback/web/:orderTrackingId', async (req, res) => {
    try {
        const { orderTrackingId } = req.params;
        const body = req.body;

        const existingTransaction = await prisma.webDonation.findFirst({
            where: { orderTrackingId },
        });

        if (existingTransaction.id) {
            await prisma.webDonation.update({
                where: { id: existingTransaction.id },
                data: {
                    status_reason: body?.reason,
                    transactionId: body?.financialTransactionId ?? '',
                    payment_status_description: body?.status.toLowerCase(),
                },
            });
        }

        res.status(200).send({ message: 'ok' });
    } catch (error) {
        if (!error.statusCode) {
            error.statusCode = 500;
        }
        next(error);
    }
});

router.put('/app/callback/app/:orderTrackingId', async (req, res) => {
    try {
        const { orderTrackingId } = req.params;
        const { status, reason } = req.body;

        const existingTransaction = await prisma.webDonation.findFirst({
            where: { orderTrackingId },
        });

        if (existingTransaction.id) {
            await prisma.webDonation.update({
                where: { id: existingTransaction.id },
                data: {
                    status_reason: reason,
                    payment_status_description: status.toLowerCase(),
                },
            });
        }

        res.status(200).send({ message: 'ok' });
    } catch (error) {
        if (!error.statusCode) {
            error.statusCode = 500;
        }
        next(error);
    }
});

// purchase or Donation transaction status
router.get(
    '/app/checkstatus/:id',
    generateMTNAuthTk,
    async (req, res, next) => {
        try {
            const OrderTrackingId = req.params.id;
            const { status, data } = await checkPaymentStatus({
                trackingId: OrderTrackingId,
                token: req.mtn_access_token,
            });

            // update transaction status in the db
            if (
                status === 'Transaction Successful' &&
                data?.financialTransactionId
            ) {
                return res.status(200).json({
                    payStatus: status,
                    financialTransactionId: data.financialTransactionId,
                });
            }

            res.status(200).json({
                payStatus: status,
                financialTransactionId: undefined,
            });
        } catch (error) {
            if (!error.statusCode) {
                error.statusCode = 500;
            }
            next(error);
        }
    }
);

export const mtnRouter = router;
