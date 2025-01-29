import { ZodError } from 'zod';
import { StatusCodes } from 'http-status-codes';

/**
 * @name validateData
 * @description Validate request body data
 * @param {import("zod").ZodObject} schema
 * @returns {import('express').RequestHandler}
 */
export function validateData(schema) {
    return async (req, res, next) => {
        try {
            const { data, error } = await schema.safeParseAsync(req.body);
            if (error) {
                throw new ZodError([error]);
            }
            req.data = data;
            next();
        } catch (error) {
            console.log(error);
            if (error instanceof ZodError) {
                const errorMessages = error.errors.map((issue) => ({
                    message: issue.message,
                }));

                
                res.status(StatusCodes.BAD_REQUEST).json({
                    error: 'Invalid body data',
                    details: JSON.parse(errorMessages[0].message)[0].message,
                });
            } else {
                res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
                    error: 'Internal Server Error',
                });
            }
        }
    };
}
