import { resend } from '@/services/resend.js';
import prisma from '@/utils/db.mjs';
import { returnError } from '@/utils/returnError.js';

/**
 *@name createSubscription
 *@description Function to add users to subscription plan
 *@type {import('express').RequestHandler}
 */
export const createSubscription = async (req, res, next) => {
   try {
      // what do we need to do here?
      // 2. if not, add them to the subscription plan that they chose
      // 3. send a confirmation via email or sms
      // 4. make a request to the payment gateway to process the payment
      // 5. Create a callback route to handle response from the payment gateway & update the user's subscription status to active
      const { plan, option, paymentNumber, saveDetails, userId } = req.body;

      // check if the user exists
      const user = await prisma.user.findUnique({
         where: {
            id: userId,
         },
      });

      if (!user) {
         returnError("Something went wrong, user doesn't exist", 400);
      }

      // check if the user has subscription
      const subscription = await prisma.subscription.findFirst({
         where: {
            plan,
            userId: user.id,
         },
      });

      if (subscription && subscription.plan !== plan) {
         returnError(
            'You already have a subscription, go to your accounts page to manage it',
            400
         );
      }

      if (subscription && subscription.plan === plan) {
         returnError(
            'Already subscribed to this plan, go to your accounts page to change your plan',
            400
         );
      }

      // add the user to the subscription plan
      const newSubscription = await prisma.subscription.create({
         data: {
            userId,
            plan,
            saveDetails,
         },
      });

      // save the user's details if keepDetails is true
      if (saveDetails) {
         await prisma.paymentMethod.create({
            data: {
               userId,
               name: option,
               details: JSON.stringify({ paymentNumber, plan, option }),
            },
         });
      }

      // TODO: Make request to the payment gateway to process the payment

      res.status(200).json({
         message: `Your ${newSubscription.plan} plan has been added successfully`,
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
 *@name getUserSubscription
 *@description Fetch the user's subscription
 *@type {import('express').RequestHandler}
 */

export const getSubscription = async (req, res, next) => {
   try {
      const { userId } = req.params;
      if (!userId) {
         returnError('User userId not passed', 400);
      }

      const subscription = await prisma.subscription.findFirst({
         where: {
            userId: userId,
         },
      });

      res.status(200).json({ subscription });
   } catch (error) {
      if (!error.statusCode) {
         error.statusCode = 500;
      }
      next(error);
   }
};

/**
 *@name updateUserSubscription
 *@description Update the user's subscription
 *@type {import('express').RequestHandler}
 *@todo Add validation to the req.body with zod using the prisma schema
 */

export const updateSubscription = async (req, res, next) => {
   try {
      const { userId } = req.params;
      if (!userId) {
         returnError('User userId not passed', 400);
      }

      const subscription = await prisma.subscription.findFirst({
         where: {
            userId: userId,
         },
      });

      if (!subscription) {
         returnError('No subscription found', 404);
      }

      const updatedSubscription = await prisma.subscription.update({
         where: {
            id: subscription.id,
         },
         data: {
            ...req.body,
         },
      });

      res.status(200).json({ subscription: updatedSubscription });
   } catch (error) {
      if (!error.statusCode) {
         error.statusCode = 500;
      }
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

      const paymentMethods = await prisma.paymentMethod.findMany({
         where: {
            userId,
         },
      });

      if (!paymentMethods) {
         returnError('No methods saved', 404);
      }

      const methods = paymentMethods.map((method) => ({
         ...method,
         details: JSON.parse(method.details),
      }));
      res.status(200).json({ methods });
   } catch (error) {
      if (!error.statusCode) {
         error.statusCode = 500;
      }

      next(error);
   }
};
