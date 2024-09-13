import { resend } from '@/services/resend.js';
import prisma from '@/utils/db.mjs';
import { returnError } from '@/utils/returnError.js';

/**
 *@name addPaymentMethod
 *@description Function to add a payment method to the user's account
 *@type {import('express').RequestHandler}
 */
export const addPaymentMethod = async (req, res, next) => {
   try {
      const { userId } = req.params;
      const { name, ...data } = req.body;

      // check if the user has subscription
      const subscription = await prisma.subscription.findUnique({
         where: {
            userId,
         },
      });

      if (!subscription) {
         returnError('You need to subscribe to a plan first', 400);
      }

      // add the payment method to the user's account
      const paymentMethod = await prisma.paymentMethod.create({
         data: {
            name,
            userId,
            details: data,
         },
      });

      // send a confirmation email or sms to the user
      return res.status(200).json({
         message: `Your ${paymentMethod.name} payment method has been added successfully`,
      });
   } catch (error) {
      if (!error.statusCode) {
         error.statusCode = 500;
      }
      next(error);
   }
};

/**
 *@name paymentCallback
 *@description Function to handle the response from the payment gateway
 *@type {import('express').RequestHandler}
 */
export const paymentCallback = async (req, res, next) => {
   try {
      // what do we need to do here?
      // 1. Get the response from the payment gateway
      // 2. if failed, send an email or sms to the user to inform them of the failure
      // 3. if successful, check if plan is active or inactive and update the user's subscription status accordingly
      // 4. Create a new billing record in the database with the payment details
      // 4. Send a confirmation email or sms to the user to confirm the payment, confirm subscription plan and update the user's subscription status
   } catch (error) {
      if (!error.statusCode) {
         error.statusCode = 500;
      }
      next(error);
      res.status(500).json({ message: 'Something went wrong!!' });
      next(error);
   }
};

/**
 *@name getUserPaymentMethods
 *@description Fetch the user's payment methods
 *@type {import('express').RequestHandler}
 */

export const getPaymentMethods = async (req, res, next) => {
   try {
      const { userId } = req.params;
      if (!userId) {
         returnError('User id not passed', 400);
      }

      let methods = await prisma.paymentMethod.findMany({
         where: { userId },
      });

      if (methods.length > 0) {
         methods = methods.map((method) => {
            if (typeof method.details === 'string') {
               method.details = JSON.parse(method.details);
            }
            return method;
         });
      }

      // find the current default payment method
      const defaultMethod = methods.find((method) => method?.defaultStatus);
      return res.status(200).json({ methods, defaultMethod });
   } catch (error) {
      if (!error.statusCode) {
         error.statusCode = 500;
      }
      next(error);
   }
};

/**
 *@name updatePaymentMethod
 *@description Update a payment method
 *@type {import('express').RequestHandler}
 *@todo Add validation to the req.body with zod using the prisma schema.
 */
export const updatePaymentMethod = async (req, res, next) => {
   try {
      // we only need to update the payment method details like the phone number, default status
      const { userId, methodId } = req.params;
      if (!userId || !methodId) {
         returnError('User id or method id not passed', 400);
      }

      const { paymentNumber, defaultStatus } = req.body;

      // get the payment method
      let method = await prisma.paymentMethod.findUnique({
         where: {
            id: methodId,
         },
      });

      if (!method) {
         returnError('Payment method not found', 404);
      }

      method.details = JSON.parse(method.details);

      // TODO: find a way to verify the payment method before updating it. eg verify the phone number via OTP
      // Or verify the card by making a small charge to it and asking the user to confirm the amount
      const update = {};

      if (paymentNumber) {
         update.details = JSON.stringify({ ...method.details, paymentNumber });
      }

      // update the method with the default status first if the defaultStatus is true
      if (defaultStatus) {
         await prisma.paymentMethod.updateMany({
            where: {
               userId,
               defaultStatus: true,
            },
            data: { defaultStatus: false },
         });

         update.defaultStatus = defaultStatus;
      }

      const updatedMethod = await prisma.paymentMethod.update({
         where: {
            id: methodId,
         },
         data: { ...update },
      });

      return res.status(200).json({
         method: updatedMethod,
         message: 'Payment method updated successfully',
      });
   } catch (error) {
      if (!error.statusCode) {
         error.statusCode = 500;
      }

      next(error);
   }
};

/**
 *@name deletePaymentMethod
 *@description Delete a payment method
 *@type {import('express').RequestHandler}
 */
export const deletePaymentMethod = async (req, res, next) => {
   try {
      const { userId, methodId } = req.params;
      if (!userId || !methodId) {
         returnError('User id or method id not passed', 400);
      }

      const method = await prisma.paymentMethod.findUnique({
         where: {
            id: methodId,
         },
      });

      if (!method) {
         returnError('Payment method not found', 404);
      }

      if (method?.defaultStatus) {
         returnError('Set another default method before deleting', 400);
      }

      //TODO: send an otp to the user to confirm the deletion

      await prisma.paymentMethod.delete({
         where: {
            id: methodId,
         },
      });

      return res.status(200).json({ message: 'Payment method deleted!!' });
   } catch (error) {
      if (!error.statusCode) {
         error.statusCode = 500;
      }

      next(error);
   }
};

/**
 *@name getPaymentHistory
 *@description Fetch the user's payment history
 *@type {import('express').RequestHandler}
 */

export const getPaymentHistory = async (req, res, next) => {
   try {
      const { userId } = req.params;
      if (!userId) {
         returnError('User id not passed', 400);
      }

      // each transaction has a user related to it
      const user = await prisma.user.findUnique({
         where: { id: userId },
         select: {
            id: true,
            paymentMethod: {
               select: {
                  id: true,
                  name: true,
                  details: true,
                  transaction: true,
               },
            },
         },
      });

      return res.status(200).json({ history: user.paymentMethod });
   } catch (error) {
      if (!error.statusCode) {
         error.statusCode = 500;
      }
      next(error);
   }
};
