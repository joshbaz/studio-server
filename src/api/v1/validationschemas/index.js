import { z } from 'zod';
import { Status, DurationUnit, Currency } from '@prisma/client';
import { isValid } from 'date-fns';

export const filmSchema = z.object({
    title: z.string({ message: 'Film title is required' }),
    overview: z.string({ message: 'Film overview is required' }),
    plotSummary: z.string({ message: 'Film plot summary is required' }),
    releaseDate: z
        .string({ message: 'Release date is required' })
        .refine((data) => isValid(new Date(data)), {
            message: 'Release date is invalid',
        }),
    type: z.string({ message: 'Film type is required' }).refine(
        (data) => {
            const types = ['movie', 'series'];
            return types.includes(data);
        },
        { message: 'Film type is invalid' }
    ),
    enableDonation: z.boolean().optional(),
    audioLanguages: z.array(z.string()).optional().default([]),
    yearOfProduction: z.string().optional().default(''),
    genre: z.array(z.string()).optional().default([]),
    tags: z.array(z.string()).optional().default([]),
    access: z
        .string()
        .optional()
        .default('free')
        .refine((data) => {
            if (data === null) {
                const accessTypes = ['free', 'premium'];
                return accessTypes.includes(data);
            }
            return true;
        }),
    visibility: z
        .string()
        .optional()
        .default('not published')
        .refine((data) => {
            if (data !== null) {
                const visibilities = [
                    'published',
                    'not published',
                    'coming soon',
                ];
                return visibilities.includes(data);
            }
            return false;
        }),
    audienceTarget: z.string().optional().default(''),
    audienceAgeGroup: z.string().optional().default(''),
    cast: z.array(z.string()).optional().default([]),
    directors: z.array(z.string()).optional().default([]),
    producers: z.array(z.string()).optional().default([]),
    writers: z.array(z.string()).optional().default([]),
    soundcore: z.array(z.string()).optional().default([]),
});

// Season schema
export const episodeSchema = z.object({
    seasonId: z.string({ message: 'Season ID is required' }).optional(),
    title: z.string({ message: 'Episode title is required' }).min(1),
    episode: z.number({ message: 'Episode number is required' }).min(1),
    overview: z.string({ message: 'Episode overview is required' }).min(1),
    plotSummary: z
        .string({ message: 'Episode plot summary is required' })
        .min(1),
    releaseDate: z
        .string({ message: 'Release date is required' })
        .refine((data) => isValid(new Date(data)), {
            message: 'Release date is invalid',
        }),
    audienceTarget: z.string().optional().default(''),
    audienceAgeGroup: z.string().optional().default(''),
    cast: z.array(z.string()).optional().default([]),
    directors: z.array(z.string()).optional().default([]),
    producers: z.array(z.string()).optional().default([]),
    writers: z.array(z.string()).optional().default([]),
    soundcore: z.array(z.string()).optional().default([]),
    audioLanguages: z.array(z.string()).optional().default([]),
    yearOfProduction: z.string().optional().default(''),
    genre: z.array(z.string()).optional().default([]),
    tags: z.array(z.string()).optional().default([]),
    visibility: z
        .string()
        .optional()
        .default('not published')
        .refine((data) => {
            if (data !== null) {
                const visibilities = [
                    'published',
                    'not published',
                    'coming soon',
                ];
                return visibilities.includes(data);
            }
            return false;
        }),
    access: z
        .string()
        .optional()
        .default('free')
        .refine((data) => {
            if (data === null) {
                const accessTypes = ['free', 'premium'];
                return accessTypes.includes(data);
            }
            return true;
        }),
});

export const seasonSchema = z.object({
    title: z
        .string({ message: 'Season title is required' })
        .min(1, { message: 'Season title is required' }),
    season: z.number({ message: 'Season number is required' }).min(1),
    filmId: z.string({ message: 'Film ID is required' }).optional(),
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

export const categorySchema = z.object({
    id: z.string().optional().nullable(),
    name: z.string({ message: 'Name is required' }),
    slug: z.string({ message: 'Slug is required' }),
    description: z.string({ message: 'Description is required' }).optional(),

    createdAt: z.string().optional().nullable(),
    updatedAt: z.string().optional().nullable(),
});

export const categoryFilmSchema = categorySchema.extend({
    filmList: z.array(z.string()).optional().default([]),
});

export const categoryUpdateSchema = z.object({
    name: z.string({ message: 'Name is required' }).optional(),
    slug: z.string({ message: 'Slug is required' }).optional(),
    description: z.string({ message: 'Description is required' }).optional(),
    filmList: z.array(z.string()).optional().default([]),
});
