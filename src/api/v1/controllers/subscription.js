import prisma from '@/utils/db.mjs';
import { returnError } from '@/utils/returnError.js';
import { subscriptionPlanSchema } from '../validationschemas/index.js';
import { z } from 'zod';
import { DurationUnit } from '@prisma/client';
import { addWeeks, addMonths, isValid } from 'date-fns';

/**
 * @name calculateNextPaymentDate
 * @description Function to calculate the next payment date
 * @param {DurationUnit} duration
 * @param {Date} startDate
 * @returns
 */
function calculateNextPaymentDate(duration, startDate) {
   if (!isValid(startDate)) throw new Error('Invalid date');
   if (duration === 'WEEK') {
      return addWeeks(startDate, 1);
   }
   if (duration === 'MONTH') {
      return addMonths(startDate, 1);
   }
}

// Subscription CRUD
/**
 *@name createSubscription
 *@description Function to add users to subscription plan
 *@type {import('express').RequestHandler}
 */
export const createSubscription = async (req, res, next) => {
   try {
      const { userId } = req.params;
      const { planId, option, paymentNumber, saveDetails } = req.body;

      // check if the user exists
      const user = await prisma.user.findUnique({
         where: {
            id: userId,
         },
         include: {
            subscription: {
               select: {
                  id: true,
                  plan: true,
               },
            },
         },
      });

      if (!user) {
         returnError("Something went wrong, user doesn't exist", 400);
      }

      // check if the user already has a subscription
      if (user.subscription.id) {
         returnError('User already has a subscription', 400);
      }

      // get the plan details
      const plan = await prisma.subscriptionPlan.findUnique({
         where: {
            id: planId,
         },
      });

      // add the user to the subscription plan
      const newSubscription = await prisma.subscription.create({
         data: {
            userId,
            saveDetails,
            plan: {
               connect: {
                  id: planId,
               },
            },
         },
      });

      // save the user's details if keepDetails is true and the user has no payment method
      if (saveDetails) {
         await prisma.paymentMethod.create({
            data: {
               name: option,
               defaultStatus: true,
               details: { paymentNumber, plan, option },
               user: {
                  connect: {
                     id: userId,
                  },
               },
            },
         });
      }

      res.status(200).json({
         message: `Your ${newSubscription.planId} plan has been added successfully`,
      });
   } catch (error) {
      if (!error.statusCode) {
         error.statusCode = 500;
      }

      next(error);
   }
};

/**
 *@name getUserSubscription
 *@description Fetch the user's subscription
 *@type {import('express').RequestHandler}
 */

export const getUserSubscription = async (req, res, next) => {
   try {
      const { userId } = req.params;
      if (!userId) {
         returnError('User userId not passed', 400);
      }

      const subscription = await prisma.subscription.findUnique({
         where: {
            userId,
         },
         include: {
            plan: true,
            user: {
               select: {
                  id: true,
                  paymentMethod: true,
               },
            },
         },
      });

      return res.status(200).json({ subscription });
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

export const updateUserSubscription = async (req, res, next) => {
   try {
      const data = req.body;
      const { userId } = req.params;
      if (!userId) {
         returnError('User userId not passed', 400);
      }

      const updatedSubscription = await prisma.subscription.update({
         where: {
            userId,
         },
         data: {
            ...data,
         },
      });

      return res.status(200).json({
         subscription: updatedSubscription,
         message: 'Subscription updated successfully',
      });
   } catch (error) {
      console.log('Error', error);
      if (!error.statusCode) {
         error.statusCode = 500;
      }
      next(error);
   }
};

// Plans CRUD

/**
 *@name addSubscriptionPlan
 *@description Resend the OTP to the user
 *@type {import('express').RequestHandler}
 *@todo Add validation to the req.body with zod using the prisma schema
 */
export const addSubscriptionPlan = async (req, res, next) => {
   try {
      const data = req.body;
      subscriptionPlanSchema.parse(data);

      const newPlan = await prisma.subscriptionPlan.create({
         data: {
            ...data,
         },
      });

      return res
         .status(201)
         .json({ plan: newPlan, message: 'Plan added successfully' });
   } catch (error) {
      if (error instanceof z.ZodError) {
         const message = error.errors.map((err) => err.message).join(', ');
         return res.status(400).json({ message: message });
      }
      console.log('Error', error);
      if (!error.statusCode) {
         error.statusCode = 500;
      }
      next(error);
   }
};

/**
 * @name assignSubscriptionPlan
 * @description Assign a subscription plan to a user
 * @type {import('express').RequestHandler'}
 */
export const assignSubscriptionPlan = async (req, res, next) => {
   try {
      const { userId, planId } = req.params;

      if (!userId || !planId) {
         returnError('User ID or Plan ID not passed', 400);
      }

      // update the user's subscription
      const subscription = await prisma.subscription.update({
         where: {
            userId,
         },
         data: {
            status: 'ACTIVE',
            plan: {
               connect: {
                  id: planId,
               },
            },
         },
      });

      return res
         .status(200)
         .json({ subscription, message: 'Subscription saved' });
   } catch (error) {
      if (!error.statusCode) {
         error.statusCode = 500;
      }
      next(error);
   }
};

/**
 *@name getSubscriptionPlans
 *@description Fetch the subscription plans
 *@type {import('express').RequestHandler}
 */
export const getSubscriptionPlans = async (req, res, next) => {
   try {
      const { userId } = req.params;

      let plans = await prisma.subscriptionPlan.findMany();

      if (userId) {
         // get the user's current subscription plan
         const subscription = await prisma.subscription.findUnique({
            where: {
               userId,
            },
            include: {
               plan: {
                  select: {
                     id: true,
                  },
               },
            },
         });

         // add a selected property to the plan
         plans = plans.map((plan) => ({
            ...plan,
            selected: plan.id === subscription.plan.id,
         }));
      }

      return res.status(200).json({ plans });
   } catch (error) {
      if (!error.statusCode) {
         error.statusCode = 500;
      }
      next(error);
   }
};

/**
 *@name updateSubscriptionPlan
 *@description Update a subscription plan
 *@type {import('express').RequestHandler}
 *@todo Add validation to the req.body with zod using the prisma schema
 */
export const updateSubscriptionPlan = async (req, res, next) => {
   try {
      const { planId } = req.params;
      const data = req.body;

      const updatedPlan = await prisma.subscriptionPlan.update({
         where: {
            id: planId,
         },
         data: {
            ...data,
         },
      });

      return res
         .status(200)
         .json({ plan: updatedPlan, message: 'Plan updated successfully' });
   } catch (error) {
      if (!error.statusCode) {
         error.statusCode = 500;
      }
      next(error);
   }
};

/**
 *@name deleteSubscriptionPlan
 *@description Delete a subscription plan
 *@type {import('express').RequestHandler}
 */
export const deleteSubscriptionPlan = async (req, res, next) => {
   try {
      const { planId } = req.params;

      await prisma.subscriptionPlan.delete({
         where: {
            id: planId,
         },
      });

      return res.status(200).json({ message: 'Plan deleted successfully' });
   } catch (error) {
      if (!error.statusCode) {
         error.statusCode = 500;
      }
      next(error);
   }
};
