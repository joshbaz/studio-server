import jwt from 'jsonwebtoken';
import { env } from '@/env.mjs';

/**
 * @name verifyToken
 * @description Verify Token Middleware
 * @type {import('express').RequestHandler}
 * @returns void
 */
export const verifyToken = (req, _, next) => {
   try {
      const token =
         req.token ||
         (req.headers.authorization && req.headers.authorization.split(' ')[1]);

      if (!token) {
         const err = new Error('Not Authenticated!');
         err.statusCode = 401;
         throw err;
      }

      jwt.verify(token, env.SECRETVA, async (err, payload) => {
         if (err) {
            const error = new Error('Token is not Valid!');
            error.statusCode = 403;
            throw error;
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
