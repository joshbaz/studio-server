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
            const types = ['film (shorts)', 'film (feature)', 'series'];
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
                const accessTypes = ['free', 'rent'];
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
    featured: z.boolean().optional().default(false),
});

export const updateFilmSchema = z.object({
    title: z.string().optional(),
    overview: z.string().optional(),
    plotSummary: z.string().optional(),
    releaseDate: z
        .string()
        .refine((data) => isValid(new Date(data)), {
            message: 'Release date is invalid',
        })
        .optional(),
    type: z
        .string()
        .refine(
            (data) => {
                const types = ['film (shorts)', 'film (feature)', 'series'];
                return types.includes(data);
            },
            { message: 'Film type is invalid' }
        )
        .optional(),
    enableDonation: z.boolean().optional(),
    audioLanguages: z.array(z.string()).optional(),
    yearOfProduction: z.string().optional(),
    genre: z.array(z.string()).optional(),
    tags: z.array(z.string()).optional(),
    access: z
        .string()
        .optional()
        .refine((data) => {
            if (data) {
                const accessTypes = ['free', 'rent'];
                return accessTypes.includes(data);
            }
            return true;
        }),
    visibility: z
        .string()
        .optional()
        .refine((data) => {
            if (data) {
                const visibilities = [
                    'published',
                    'not published',
                    'coming soon',
                ];
                return visibilities.includes(data);
            }
            return true;
        }),
    audienceTarget: z.string().optional(),
    audienceAgeGroup: z.string().optional(),
    cast: z.array(z.string()).optional(),
    directors: z.array(z.string()).optional(),
    producers: z.array(z.string()).optional(),
    writers: z.array(z.string()).optional(),
    soundcore: z.array(z.string()).optional(),
    featured: z.boolean().optional(),
    donationTargetAmount: z.number().optional(),
    donationDeadline: z.string().optional(),
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
                const accessTypes = ['free', 'rent'];
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

export const categorySchema = z
    .object({
        name: z.string({ message: 'Name is required' }),
        type: z.union(
            [
                z.literal('mixed'),
                z.literal('films'),
                z.literal('series'),
                z.literal('genre'),
            ],
            { message: 'Type is required' }
        ),
        films: z.array(z.string()).optional().default([]),
        genre: z.array(z.string()).optional().default([]),
        seasons: z.array(z.string()).optional().default([]),
    })
    .superRefine((data, ctx) => {
        // Validate 'mixed' or 'films' requires a non-empty films array
        if (
            (data.type === 'mixed' || data.type === 'films') &&
            data.films.length === 0
        ) {
            ctx.addIssue({
                path: ['films'],
                message:
                    "Films array cannot be empty when type is 'mixed' or 'films'",
            });
        }

        // Validate 'series' requires a non-empty seasons array
        if (data.type === 'series' && data.seasons.length === 0) {
            ctx.addIssue({
                path: ['seasons'],
                message: "Seasons array cannot be empty when type is 'series'",
            });
        }

        // Validate 'genre' requires a non-empty genre array
        if (data.type === 'genre' && data.genre.length === 0) {
            ctx.addIssue({
                path: ['genre'],
                message: "Genre array cannot be empty when type is 'genre'",
            });
        }
    });

export const updateCategorySchema = z.object({
    name: z.string({ message: 'Name is required' }),
});

export const addCategorySchema = z
    .object({
        type: z.union(
            [
                z.literal('films'),
                z.literal('series'),
                z.literal('genre'),
                z.literal('mixed'),
            ],
            { message: 'Type is required' }
        ),
        films: z.array(z.string()).optional().default([]),
        seasons: z.array(z.string()).optional().default([]),
        genre: z.array(z.string()).optional().default([]),
    })
    .superRefine((data, ctx) => {
        // Validate 'mixed' or 'films' requires a non-empty films array
        if (
            (data.type === 'mixed' || data.type === 'films') &&
            data.films.length === 0
        ) {
            ctx.addIssue({
                path: ['films'],
                message:
                    "Films array cannot be empty when type is 'mixed' or 'films'",
            });
        }

        // Validate 'series' requires a non-empty seasons array
        if (data.type === 'series' && data.seasons.length === 0) {
            ctx.addIssue({
                path: ['seasons'],
                message: "Seasons array cannot be empty when type is 'series'",
            });
        }
        // Validate 'genre' requires a non-empty genre array
        if (data.type === 'genre' && data.genre.length === 0) {
            ctx.addIssue({
                path: ['genre'],
                message: "Genre array cannot be empty when type is 'genre'",
            });
        }
    });

export const removeFilmFromCategorySchema = z
    .object({
        type: z.union(
            [
                z.literal('films'),
                z.literal('series'),
                z.literal('genre'),
                z.literal('mixed'),
            ],
            { message: 'Type is required' }
        ),
        films: z.array(z.string()).optional().default([]),
        seasons: z.array(z.string()).optional().default([]),
    })
    .superRefine((data, ctx) => {
        // Validate 'mixed' or 'films' requires a non-empty films array
        const types = ['mixed', 'films', 'genre', 'series'];
        if (!types.includes(data.type)) {
            ctx.addIssue({
                path: ['type'],
                message: 'Type is invalid',
            });
        }
        const requiresFilms =
            data.type === 'mixed' ||
            data.type === 'films' ||
            data.type === 'genre';
        if (requiresFilms && data.films.length === 0) {
            ctx.addIssue({
                path: ['films'],
                message:
                    "Films array cannot be empty when type is 'mixed' or 'films' or 'genre'",
            });
        }

        // Validate 'series' requires a non-empty seasons array
        if (data.type === 'series' && data.seasons.length === 0) {
            ctx.addIssue({
                path: ['seasons'],
                message: "Seasons array cannot be empty when type is 'series'",
            });
        }
    });

// pricing schema
export const pricingSchema = z.object({
    type: z.union([z.literal('movie'), z.literal('season')], {
        message: 'Type movie or season is required',
    }),
    resourceId: z.string({ message: 'Either filmId or seasonId is required' }),
    currency: z
        .string({ message: 'Currency is required' })
        .default('UGX')
        .refine((data) => {
            const currencies = Object.values(Currency);
            return currencies.includes(data);
        }),
    priceList: z.array(
        z.object({
            price: z.number({ message: 'Price is required' }),
            resolution: z.union(
                [
                    z.literal('SD'),
                    z.literal('HD'),
                    z.literal('FHD'),
                    z.literal('UHD'),
                ],
                { message: 'resolution should only be SD, HD, FHD or UHD' }
            ),
        })
    ),
});

export const updatePricingSchema = z.object({
    currency: z
        .string({ message: 'Currency is required' })
        .optional()
        .refine((data) => {
            if (!data) return true;
            const currencies = Object.values(Currency);
            return currencies.includes(data);
        }),
    priceList: z.array(
        z.object({
            id: z.string({ message: 'ID is required' }),
            price: z.number({ message: 'Price is required' }),
        })
    ),
});
