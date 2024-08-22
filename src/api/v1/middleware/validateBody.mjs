import { ZodError } from 'zod';
import { StatusCodes } from 'http-status-codes';

/**
 * @name validateData
 * @description Validate request body data
 * @param {import("zod").ZodObject} schema
 * @returns {import('express').RequestHandler}
 */
export function validateData(schema) {
   return (req, res, next) => {
      try {
         schema.parse(req.body);
         console.log('Schema', schema);
         next();
      } catch (error) {
         if (error instanceof ZodError) {
            const errorMessages = error.errors.map((issue) => ({
               message: issue.message,
            }));
            res.status(StatusCodes.BAD_REQUEST).json({
               error: 'Invalid data',
               details: errorMessages,
            });
         } else {
            res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
               error: 'Internal Server Error',
            });
         }
      }
   };
}
