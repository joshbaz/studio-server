import * as express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import api from '@/api/index.mjs';
import { env } from './env.mjs';

/**
 * @module app
 * @name customizeApp
 * @description Customize the Express app instance
 * @param {express.Application} app - The Express app instance
 * @returns {void}
 */
export default function customizeApp(app) {
   app.use(express.json());
   app.use(express.urlencoded({ extended: false }));

   /**
    * @name corsOptions
    * @description Cors options
    * @type {cors.CorsOptions}
    */
   const corsOptions = {
      origin: [env.CLIENT_URL],
      methods: ['GET', 'POST', 'PUT', 'DELETE'],
      preflightContinue: false,
      credentials: true,
   };

   app.use(cors(corsOptions));
   app.use(cookieParser());

   // API routes
   app.use('/api', api);

   // Error handling - 404
   app.use((_, res) => {
      res.status(404).send({
         status: 404,
         message: 'The requested resource was not found',
      });
   });

   //Error handling - 5xx
   app.use((err, _, res) => {
      if (!err.statusCode) {
         err.statusCode = 500;
      }
      res.status(500).send({
         status: 500,
         message: `Internal Server Error: ${err.message}`,
      });
   });
}
