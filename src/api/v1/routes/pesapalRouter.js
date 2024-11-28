import express from 'express';
// import dotenv from 'dotenv';
// import transactModel from '../models/transactionModel.js';

// import { v4 as uuidv4 } from 'uuid';
// import axios from 'axios';
// import multer from 'multer';
// /** emailing modules */
// // import hogan from 'hogan.js';
// import fs from 'fs';
// import { generateIPN_ID, generatePesaAuthTk } from '../middleware/pesapalmw.js';
// import {
//     PESA_URL,
//     pesaCheckStatus,
//     pesapalPaymentRequest,
// } from '@/services/pesapal.js';
// import { returnError } from '@/utils/returnError.js';
// import prisma from '@/utils/db.mjs';

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

// //make donation.
// router.post(
//     '/donate',
//     generatePesaAuthTk,
//     generateIPN_ID,
//     async (req, res, next) => {
//         try {
//             let { body } = req;
//             //console.log("tokenRP", req.bearertk, req.ipn_id);
//             console.log(body, 'Body', req.body);

//             const createdUUID = uuidv4();

//             if (req.body.paymentType !== 'Visa') {
//                 returnError('Invalid payment type', 400);
//             }

//             let PesaRequestLink = `${PESA_URL}/api/Transactions/SubmitOrderRequest`;

//             let headers = {
//                 'Content-Type': 'application/json',
//                 Accept: 'application/json',
//                 Authorization: req.bearertk,
//             };

//             let requestParameters = {
//                 id: createdUUID,
//                 paym: 'Visa',
//                 currency: 'UGX',
//                 amount: req.body.amount,
//                 description: `Donation- ${req.body.note}`,
//                 callback_url: `${process.env.CLIENT_URL}/pay-response`,
//                 cancellation_url: '', //optional
//                 notification_id: req.ipn_id,
//                 branch: '',
//                 billing_address: {
//                     phone_number: req.body.phonenumber,
//                     email_address: req.body.email,
//                     country_code: '', //optional
//                     first_name: req.body.firstname, //optional
//                     middle_name: '',
//                     last_name: req.body.lastname,
//                     line_1: '',
//                     line_2: '',
//                     city: '',
//                     state: '',
//                     postal_code: '',
//                     zip_code: '',
//                 },
//             };

//             let submitOrder = await axios.post(
//                 PesaRequestLink,
//                 requestParameters,
//                 { headers: headers }
//             );
//             console.log('submitOrder', submitOrder.data);

//             const { data } = await pesapalPaymentRequest({
//                 token: req.bearertk,
//                 firstName: req.body.firstname,
//                 lastName: req.body.lastname,
//                 description: `Donation- ${req.body.note}`,
//                 amount: req.body.amount,
//                 ipnID: req.ipn_id,
//                 callbackURL: `${process.env.CLIENT_URL}/pay-response`,
//             });

//             if (data.error) {
//                 console.log('error', data.error);
//                 returnError(data.error.message, 500);
//             }

//             if (data?.order_tracking_id) {
//                 await prisma.webDonation.create({
//                     data: {
//                         transactionType: 'donation',
//                         paymentType: 'PesaPal -',
//                         amount: req.body.amount,
//                         purpose: req.body.note,
//                         currency: 'UGX',
//                         email: req.body.email,
//                         phonenumber: req.body.phonenumber,
//                         firstname: req.body.firstname,
//                         lastname: req.body.lastname,
//                         orderTrackingId: data.order_tracking_id,
//                         payment_status_description: 'Pending',
//                         status_reason: '',
//                     },
//                 });
//             }

//             console.log('data', data);

//             res.status(200).json({
//                 ...data,
//             });
//         } catch (error) {
//             if (!error.statusCode) {
//                 error.statusCode = 500;
//             }
//             next(error);
//         }
//     }
// );

// /** route for pesapal-status-notification only */
// router.get('/tansact_statuses', generatePesaAuthTk, async (req, res, next) => {
//     try {
//         console.log('here');
//         //  console.log("working to make connections", req.body, req.query);
//         //console.log("working", req);
//         // const { OrderTrackingId, OrderNotificationType, OrderMerchantReference } = req.query;
//         //  let url_parts = url.parse(req.url, true);
//         // let query = url_parts.query;
//         // console.log("query parts", query)

//         const { OrderTrackingId } = req.query;

//         //console.log("OrderTrackingId", OrderTrackingId)

//         let PesaRequestLink = `${PESA_URL}/api/Transactions/GetTransactionStatus?orderTrackingId=${OrderTrackingId}`;

//         let headers = {
//             'Content-Type': 'application/json',
//             Accept: 'application/json',
//             Authorization: req.pesa_access_token,
//         };

//         let submitStatusRequest = await axios.get(PesaRequestLink, {
//             headers: headers,
//         });

//         const { data } = pesaCheckStatus({
//             token: req.bearertk,
//             orderTrackingId: OrderTrackingId,
//         });

//         if (!data) {
//             returnError('Something went wrong!!', 400);
//         }

//         const existingTransact = await prisma.webDonation.findFirst({
//             where: {
//                 orderTrackingId: OrderTrackingId,
//             },
//         });

//         if (!existingTransact.id) {
//             returnError('Transaction not found', 404);
//         }

//         if (existingTransact.payment_status_description !== 'Pending') {
//             res.status(200).json({
//                 payment_status_description:
//                     submitStatusRequest.data.payment_status_description,
//                 paidAmount: amount,
//                 paymentType: `PesaPal-${submitStatusRequest.data.payment_method}`,
//                 transactionId: getTransact._id,
//                 currency: submitStatusRequest.data.currency,
//             });

//         }

//         console.log('submitStatusRequest', submitStatusRequest.data);
//         if (!submitStatusRequest.data) {
//             console.log('error', submitStatusRequest.data);
//         } else {
//             const {
//                 payment_method,
//                 amount,
//                 payment_status_description,
//                 description,
//                 payment_account,
//                 currency,
//                 message,
//             } = submitStatusRequest.data;

//             //console.log("pay-req", payment_status_description)
//             let getTransact = await transactModel.findOne({
//                 orderTrackingId: OrderTrackingId,
//             });

//             //console.log("getTransact", getTransact)
//             if (!getTransact) {
//                 const error = new Error('Transaction missing');
//                 error.statusCode = 404;
//                 throw error;
//             } else if (
//                 getTransact &&
//                 getTransact.payment_status_description !== 'Pending'
//             ) {
//                 res.status(200).json({
//                     payment_status_description:
//                         submitStatusRequest.data.payment_status_description,
//                     paidAmount: amount,
//                     paymentType: `PesaPal-${submitStatusRequest.data.payment_method}`,
//                     transactionId: getTransact._id,
//                     currency: submitStatusRequest.data.currency,
//                 });
//             } else {
//                 getTransact.payment_status_description = `${submitStatusRequest.data.payment_status_description}`;
//                 getTransact.paidAmount = amount;
//                 getTransact.status_reason =
//                     submitStatusRequest.data.description;
//                 getTransact.currency = submitStatusRequest.data.currency;
//                 getTransact.paymentType = `PesaPal-${submitStatusRequest.data.payment_method}`;

//                 getTransact.save();
//                 console.log('registered');
//                 let template = fs.readFileSync('./payNotify.hjs', 'utf-8');

//                 let compiledTemplate = hogan.compile(template);

//                 let mailOptions = {
//                     from: 'joshuakimbareeba@gmail.com',
//                     to: 'stephaniekirathe@gmail.com',
//                     cc: 'charlesaroma9@gmail.com, mymbugua@gmail.com',
//                     subject: 'Alert - Payment Received',
//                     html: compiledTemplate.render({
//                         transactionType: getTransact.transactionType,
//                         paidAmount: `${amount} ${currency}`,
//                         paymentType: `PesaPal-${submitStatusRequest.data.payment_method}`,
//                         title: 'Alert - Payment Received',
//                     }),
//                 };

//                 transporter.sendMail(mailOptions, async (error, info) => {
//                     if (error) {
//                         console.log(error);
//                     } else {
//                         console.log('email sent: ');
//                     }
//                 });
//                 res.status(200).json({
//                     payment_status_description:
//                         submitStatusRequest.data.payment_status_description,
//                     paidAmount: amount,
//                     paymentType: `PesaPal-${submitStatusRequest.data.payment_method}`,
//                     transactionId: getTransact._id,
//                     currency: submitStatusRequest.data.currency,
//                     status: 200,
//                     orderNotificationType: 'IPNCHANGE',
//                     orderTrackingId: OrderTrackingId,
//                 });
//             }
//         }
//     } catch (error) {
//         if (!error.statusCode) {
//             error.statusCode = 500;
//             console.log('error', error);
//         }
//         next(error);
//     }
// });

// //check transaction details.

export const pesapalRouter = router;
