import * as express from 'express';

import api from './api/index.mjs';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import { env } from './env.mjs';
import rateLimit from 'express-rate-limit';

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
      origin: [
         env.CLIENT_URL,
         'http://localhost:8081',
         'http://192.168.0.184:4500',
      ],
      methods: ['GET', 'POST', 'PUT', 'DELETE'],
      preflightContinue: false,
      credentials: true,
   };
   app.use(cors(corsOptions));

   // Rate limiter
   const limiter = rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 100, // limit each IP to 100 requests per windowMs
   });
   app.use(limiter);

   // Cookie parser
   app.use(cookieParser());

   // Compression
   app.use(compression());

   // API routes
   app.use('/api', api);

   // Error handling - 4xx except 404
   app.use((err, _, res, next) => {
      if (err.statusCode >= 400 && err.statusCode < 500) {
         let message = err.message;
         if (!message && err.statusCode === 404) {
            message = 'The requested resource was not found';
         }

         res.status(err.statusCode).send({ message });
      } else {
         next(err);
      }
   });

   //Error handling - 5xx
   app.use((err, req, res) => {
      console.log('Original URL:', req.originalUrl, 'Method:', req.method);
      console.error('Erroro', err.statusMessage || err.message);
      if (!err.statusCode) {
         err.statusCode = 500;
      }
      res.status(500).send({
         message: `Internal Server Error: ${err.message}`,
      });
   });
}
