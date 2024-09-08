import { z } from 'zod';
import { Status, DurationUnit, Currency } from '@prisma/client';

export const filmSchema = z.object({
   title: z.string({ message: 'Film title is required' }),
   overview: z.string({ message: 'Film overview is required' }),
   plotSummary: z.string({ message: 'Film plot summary is required' }),
   releaseDate: z.string({ message: 'Film release date is required' }),
   type: z.string({ message: 'Film type is required' }).superRefine((data) => {
      const types = [
         'movie',
         'series',
         'documentary',
         'shortfilm',
         'animation',
      ];
      if (!types.includes(data)) {
         throw new Error('Film type is invalid');
      }
   }),
   adminId: z.string({ message: 'Admin ID is required' }),
});

export const filmSchemaUpdate = z.object({
   adminId: z.string({ message: 'Admin ID is required' }),
});

export const paymentSchema = z.object({
   plan: z.string({ message: 'Plan is required' }),
   paymentMethod: z.string({ message: 'Payment method is required' }),
   phoneNumber: z.string({ message: 'Contact is required' }),
   keepDetails: z.boolean({ message: 'Keep details is required' }),
});

// Subscription schema
export const subscriptionSchema = z.object({
   userId: z.string({ message: 'User ID is required' }),
   status: z.string({ message: 'Status is required' }).superRefine((data) => {
      const statuses = [Status.ACTIVE, Status.CANCELLED, Status.INACTIVE];
      if (!statuses.includes(data)) {
         throw new Error('Status is invalid');
      }
   }),
   saveDetails: z
      .boolean({ message: 'Save details is required' })
      .default(false),
   nextPayment: z.string({ message: 'Next payment is required' }),
   planId: z.string({ message: 'Plan ID is required' }),
});

// subscription plan schema
export const subscriptionPlanSchema = z.object({
   name: z.string({ message: 'Name is required' }),
   description: z.string().optional().default(''),
   price: z.number({ message: 'Price is required' }),
   currency: z.string({ message: 'Currency is required' }).refine((data) => {
      const currencies = Object.values(Currency);
      return currencies.includes(data);
   }),
   duration: z.string({ message: 'Duration is required' }).refine((data) => {
      const durations = Object.values(DurationUnit);
      return durations.includes(data);
   }),
   deletedAt: z.string().optional().nullable(),
});
