import jwt from 'jsonwebtoken';
import { env } from '@/env.mjs';

/**
 * @name verifyToken
 * @description Verify Token Middleware
 * @type {import('express').RequestHandler}
 * @returns void
 */
export const verifyToken = (req, res, next) => {
   try {
      const token = req.cookies.token;

      if (!token) {
         return res.status(401).json({ message: 'Not Authenticated!' });
      }

      jwt.verify(token, env.SECRETVA, async (err, payload) => {
         if (err) {
            return res.status(403).json({ message: 'Token is not Valid!' });
         }

         req.userId = payload.id;
         next();
      });
   } catch (error) {
      if (!error.statusCode) {
         error.statusCode = 500;
      }
      res.status(500).json({ message: 'Something went wrong' });
   }
};
