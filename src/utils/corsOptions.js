import { env } from '@/env.mjs';

/**
 * @name corsOptions
 * @description Cors options
 * @type {cors.CorsOptions}
 */
export const CORS_OPTIONS = {
    origin: [
        env.CLIENT_URL,
        'http://localhost:8081',
        'http://192.168.0.184:4500',
        'http://localhost:5173',
        'http://localhost:5174',
        'https://staging.nyatimotionpictures.com',
        'https://nyatimotionpictures.com',
        'https://studio.nyatimotionpictures.com',
        'https://stream.nyatimotionpictures.com',
    ],
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    preflightContinue: false,
    credentials: true,
};
