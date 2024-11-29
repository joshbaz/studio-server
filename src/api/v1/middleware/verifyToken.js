import jwt from 'jsonwebtoken';
import { env } from '@/env.mjs';
// import { returnError } from '@/utils/returnError.js';

/**
 * @name verifyToken
 * @description Verify Token Middleware
 * @type {import('express').RequestHandler}
 * @returns void
 */
export const verifyToken = async (req, res, next) => {
    try {
        console.log('Logging token');
        const token =
            req.token ||
            (req.headers.authorization &&
                req.headers.authorization.split(' ')[1]);

        if (!token) {
            const err = new Error('Not Authenticated!');
            err.statusCode = 401;
            throw err;
        }

        jwt.verify(token, env.SECRETVA, async (err, payload) => {
            if (err) {
                if (err.name === 'TokenExpiredError') {
                    return res.status(401).json({ message: 'Token expired' });
                }

                return res
                    .status(401)
                    .json({ message: 'You are not authenticated' });
                // returnError("You're not authenticated", 401);
            }

            req.userId = payload.id;
            next();
        });
    } catch (error) {
        if (!error.statusCode) {
            error.statusCode = 500;
        }
        next(error);
    }
};
