import express from 'express';
// import dotenv from 'dotenv';
// import transactModel from '../models/transactionModel.js';

import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';
import multer from 'multer';
/** emailing modules */
// import hogan from 'hogan.js';
// import fs from 'fs';
// import { generateIPN_ID, generatePesaAuthTk } from '../middleware/pesapalmw.js';
// import {
//     PESA_URL,
//     pesaCheckStatus,
//     pesapalPaymentRequest,
// } from '@/services/pesapal.js';
import { returnError } from '@/utils/returnError.js';
import prisma from '@/utils/db.mjs';
import { generateIPN_ID, generatePesaAuthTk } from '../middleware/pesapalmw.js';


const router = express.Router();

// dotenv.config();

// const upload = multer({
//     storage: multer.memoryStorage(),
// });

// /** nodemailer transporter */
// const transporter = nodemailer.createTransport({
//     service: 'gmail',
//     secure: true,
//     auth: {
//         user: process.env.gUser2,
//         pass: process.env.gPass2,
//     },
// });

//make donation.
router.post(
    '/donate',
    generatePesaAuthTk,
    generateIPN_ID,
    async (req, res, next) => {
        try {
            let { body } = req;
            //console.log("tokenRP", req.bearertk, req.ipn_id);
            console.log(body, 'Body', req.body);

            const createdUUID = uuidv4(new Date());

            if (req.body.paymentType !== 'Visa') {
                returnError('Invalid payment type', 400);
            }

            let PESA_URL = "https://pay.pesapal.com/v3";

            let PesaRequestLink = `${PESA_URL}/api/Transactions/SubmitOrderRequest`;

            let headers = {
                'Content-Type': 'application/json',
                Accept: 'application/json',
                Authorization: req.bearertk,
            };

            let requestParameters = {
                id: createdUUID,
              
                currency: 'UGX',
                amount: req.body.amount,
                description: `Donation- ${req.body.note}`,
                callback_url: req.body?.type === "streamWeb"? 'https://stream.nyatimotionpictures.com/pesapay/generaldonation/success' : `https://nyatimotionpictures.com/pay-response`,
                cancellation_url: req.body?.type === "streamWeb"? 'https://stream.nyatimotionpictures.com/pesapay/cancel' : '',
                // cancellation_url: '', //optional
                notification_id: req.ipn_id,
                branch: '',
                billing_address: {
                    phone_number: req.body.phonenumber,
                    email_address: req.body.email,
                    country_code: '', //optional
                    first_name: req.body.firstname, //optional
                    middle_name: '',
                    last_name: req.body.lastname,
                    line_1: '',
                    line_2: '',
                    city: '',
                    state: '',
                    postal_code: '',
                    zip_code: '',
                },
            };

            let submitOrder = await axios.post(
                PesaRequestLink,
                requestParameters,
                { headers: headers }
            );
            console.log('submitOrder', submitOrder.data);

            if (submitOrder.data.error) {
                console.log('error', data.error);
                returnError(data.error.message, 500);
            }

            if (submitOrder?.data?.order_tracking_id) {
                await prisma.webDonation.create({
                    data: {
                        transactionType: 'donation',
                        paymentType: 'PesaPal -',
                        amount: req.body.amount,
                        purpose: req.body.note,
                        currency: 'UGX',
                        email: req.body.email,
                        phonenumber: req.body.phonenumber,
                        firstname: req.body.firstname,
                        lastname: req.body.lastname,
                        orderTrackingId: submitOrder.data.order_tracking_id,
                        payment_status_description: 'Pending',
                        status_reason: '',
                    },
                });
            }

            

            res.status(200).json({
                ...submitOrder.data,
            });
        } catch (error) {
            if (!error.statusCode) {
                error.statusCode = 500;
            }
            next(error);
        }
    }
);


/** route for pesapal-status-notification only */
router.get('/tansact_statuses', generatePesaAuthTk, async (req, res, next) => {
    try {
       
        const { OrderTrackingId } = req.query;

        let PESA_URL = "https://pay.pesapal.com/v3";
        let PesaRequestLink = `${PESA_URL}/api/Transactions/GetTransactionStatus?orderTrackingId=${OrderTrackingId}`;

        let headers = {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Authorization: req.pesa_access_token,
        };

        let submitStatusRequest = await axios.get(PesaRequestLink, {
            headers: headers,
        });

        // const { data } = pesaCheckStatus({
        //     token: req.bearertk,
        //     orderTrackingId: OrderTrackingId,
        // });

        if (!submitStatusRequest.data) {
            returnError('Something went wrong!!', 400);
        }

        const existingTransact = await prisma.webDonation.findFirst({
            where: {
                orderTrackingId: OrderTrackingId,
            },
        });

        if (!existingTransact.id) {
            returnError('Transaction not found', 404);
        }

        if (existingTransact.payment_status_description !== 'Pending') {
            res.status(200).json({
                payment_status_description:
                    submitStatusRequest.data.payment_status_description,
                paidAmount: amount,
                paymentType: `PesaPal-${submitStatusRequest.data.payment_method}`,
                transactionId: existingTransact.id,
                currency: submitStatusRequest.data.currency,
            });

        }else {
           
            const updatedTransaction = await prisma.webDonation.update({
                where: { id: existingTransact.id },
                data: {
                    payment_status_description:  submitStatusRequest.data.payment_status_description,
                    status_reason: submitStatusRequest.data.description ?? '',
                    currency: submitStatusRequest.data.currency ?? '',
                    paidAmount: submitStatusRequest.data.amount,
                    paymentType: `PesaPal-${submitStatusRequest.data.payment_method}`,
                    transactionId: existingTransact.id ?? '',
                },
            });
          
           
                res.status(200).json({
                    payment_status_description:
                        submitStatusRequest.data.payment_status_description,
                    paidAmount: submitStatusRequest.data.amount,
                    paymentType: `PesaPal-${submitStatusRequest.data.payment_method}`,
                    transactionId: existingTransact.id,
                    currency: submitStatusRequest.data.currency,
                    status: 200,
                    orderNotificationType: 'IPNCHANGE',
                    orderTrackingId: OrderTrackingId,
                });
            
        }
    } catch (error) {
        if (!error.statusCode) {
            error.statusCode = 500;
            console.log('error', error);
        }
        next(error);
    }
});

// //check transaction details.

export const pesapalRouter = router;
