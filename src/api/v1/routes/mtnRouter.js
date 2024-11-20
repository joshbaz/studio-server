import express from 'express';
import dotenv from 'dotenv';
import { generateMTNAuthTk } from '../middleware/generateMTNAuthTK.js';
import {
    TARGET_ENV,
    SUBSCRIPTION_KEY,
    MOMO_BASE_URL,
    mtnPaymentRequest,
    checkPaymentStatus,
} from '@/services/mtnpayments.js';
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';
import multer from 'multer';
import prisma from '@/utils/db.mjs';
import { returnError } from '@/utils/returnError.js';
import { env } from '@/env.mjs';

dotenv.config();

const router = express.Router();

// Website Transactions
router.post('/donate', generateMTNAuthTk, async (req, res, next) => {
    try {
        console.log('mtn bearerTk', req.mtn_access_token);

        const createdUUID = uuidv4();

        //   console.log("createdUUIS", createdUUID)
        if (req.body.paymentType === 'MTN') {
            let MTNRequestLink = `${MOMO_BASE_URL}/collection/v1_0/requesttopay`;

            let currency = env.NODE_ENV === 'production' ? 'UGX' : 'EUR';
            console.log('currency', currency);

            const donateTransaction = await prisma.webDonation.create({
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
                    orderTrackingId: createdUUID,
                    payment_status_description: 'Pending',
                },
            });

            /**
            All Statuses Expected & testCases:
            Failed - 46733123450
            Rejected - 46733123451
            Timeout - 46733123452
            Success - 56733123453
            Pending - 46733123454
            
        */

            let requestParameters = {
                amount: req.body.amount,
                currency: currency,
                externalId: donateTransaction.id, // can be orderId(payrequest Id) or transac-Id
                payer: {
                    partyIdType: 'MSISDN',
                    partyId: req.body.phonenumber, //phonenumber must be 256
                },
                payerMessage:
                    'Donation of amount / Monthly Subscription for Nyati', //Reason for Payment
                payeeNote: '',
            };

            let headers = {
                'Content-Type': 'application/json',
                Authorization: req.mtn_access_token,
                'X-Callback-Url': `${MOMO_BASE_URL}/nyatimtn/status/${createdUUID}`,
                'X-Reference-Id': `${createdUUID}`,
                'X-Target-Environment': TARGET_ENV,
                'Ocp-Apim-Subscription-Key': SUBSCRIPTION_KEY,
            };
            console.log('requestParameters', requestParameters);

            let submitOrderRequest = await axios.post(
                MTNRequestLink,
                requestParameters,
                { headers: headers }
            );
            console.log('submitOrderRequest', submitOrderRequest.data);
            res.status(200).json({
                orderTrackingId: createdUUID,
            });
        } else {
            res.status(500).json('Check Payment Selected');
        }
    } catch (error) {
        if (!error.statusCode) {
            error.statusCode = 500;
            console.log('error', error);
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
            console.log(' req.params.id', orderTrackingId);
            const getTransact = await prisma.webDonation.findFirst({
                where: { orderTrackingId },
            });

            if (!getTransact.id) returnError('Transaction not found', 404);

            let MTNRequestLink = `${MOMO_BASE_URL}/collection/v1_0/requesttopay/${orderTrackingId}`;

            let headers = {
                //  "Content-Type": "application/json",
                Authorization: req.mtn_access_token,
                'X-Target-Environment': TARGET_ENV,
                'Ocp-Apim-Subscription-Key': SUBSCRIPTION_KEY,
            };

            let submitStatusRequest = await axios.get(MTNRequestLink, {
                headers: headers,
            });

            console.log('response from MTN', submitStatusRequest.data);
            console.log('transactStatus', submitStatusRequest.data.status);

            const selectMessage = (shortMessage) => {
                switch (shortMessage) {
                    case 'failed':
                        return 'Transaction has Failed';
                    case 'successful':
                        return 'Transaction Successful';
                    case 'pending':
                        return 'Transaction Pending';
                    case 'rejected':
                        return 'Transaction Rejected';
                    case 'timeout':
                        return 'Transaction Timedout';
                    default:
                        return null;
                }
            };
            let transactStatus = selectMessage(
                submitStatusRequest.data.status.toLowerCase()
            );
            console.log('transactStatus2', transactStatus);
            //check if transaction status same as the saved one in the db

            if (transactStatus !== getTransact.payment_status_description) {
                console.log('In DB', transactStatus);
                const updatedTransaction = await prisma.webDonation.update({
                    where: { id: getTransact.id },
                    data: {
                        payment_status_description: transactStatus,
                        status_reason: transactStatus,
                        transactionId:
                            submitStatusRequest.data.financialTransactionId,
                    },
                });

                console.log(
                    'Saved Status',
                    updatedTransaction.payment_status_description
                );
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

        const currency = env.NODE_ENV === 'production' ? 'UGX' : 'EUR';

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
            //callbackURL: `${MOMO_BASE_URL}/nyatimtn/status`,
        });

        res.status(200).json({
            status,
            orderTrackingId,
        });
    } catch (error) {
        if (!error.statusCode) {
            error.statusCode = 500;
            console.log('error', error);
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
        const currency = env.NODE_ENV === 'production' ? 'UGX' : 'EUR';

        /**
            All Statuses Expected & testCases:
            Failed - 46733123450
            Rejected - 46733123451
            Timeout - 46733123452
            Success - 56733123453
            Pending - 46733123454

        */

        // const requestParameters = {
        //     currency,
        //     amount: req.body.amount,
        //     externalId: createdUUID, // can be orderId(payrequest Id) or transac-Id
        //     payer: {
        //         partyIdType: 'MSISDN',
        //         partyId: req.body.phoneNumber, //phonenumber must be 256
        //     },
        //     payerMessage: `Purchase for film ${req.body.filmName}`, //Reason for Payment
        //     payeeNote: '',
        // };

        // console.log('request parameters', requestParameters);

        const { status, orderTrackingId } = await mtnPaymentRequest({
            token: req.mtn_access_token,
            amount: req.body.amount,
            currency: currency,
            phoneNumber: req.body.phoneNumber,
            paymentMessage: `Purchase for film ${req.body.filmName}`,
            payeeNote: '',
            callbackURL: `http://localhost:4500/api/v1/payment/mtn/app/callback`,
            // callbackURL: `${MOMO_BASE_URL}/nyatimtn/status`,
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

router.put('/app/callback/:orderTrackingId', (req, res) => {
    console.log('MTN callback', req.body);
    res.status(200).send({ message: 'Payment successful' });
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
                    // transaction,
                });
            }

            // checkst= s => /film/create/purchased/:filmId
            // const MTNRequestLink = `${MOMO_BASE_URL}/collection/v1_0/requesttopay/${OrderTrackingId}`;

            // const headers = {
            //     'Content-Type': 'application/json',
            //     Authorization: req.mtn_access_token,
            //     'X-Target-Environment': TARGET_ENV,
            //     'Ocp-Apim-Subscription-Key': SUBSCRIPTION_KEY,
            // };

            // const submitStatusRequest = await axios.get(MTNRequestLink, {
            //     headers: headers,
            // });

            /**
            All Statuses Expected & testCases:
            Failed 
            Rejected
            Timeout
            Success
            Pending
            
            */

            // console.log("response from MTN", submitStatusRequest.data);
            // console.log("transactStatus", submitStatusRequest.data.status);

            // const selectMessage = (shortMessage) => {
            //     switch (shortMessage) {
            //         case 'failed':
            //             return 'Transaction has Failed';
            //         case 'successful':
            //             return 'Transaction Successful';
            //         case 'pending':
            //             return 'Transaction Pending';
            //         case 'rejected':
            //             return 'Transaction Rejected';
            //         case 'timeout':
            //             return 'Transaction Timedout';
            //         default:
            //             return null;
            //     }
            // };
            // const transactStatus = selectMessage(
            //     submitStatusRequest.data.status.toLowerCase()
            // );

            //check if transaction status same as the saved one in the db

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
