import * as express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import api from '@src/api/index.mjs';

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

   app.use(
      cors({
         origin: process.env.CLIENT_URL,
         credentials: true,
      })
   );

   app.use(cookieParser());
   // API routes
   app.use('/api', api);

   // Error handling
   // 404
   app.use((req, res) => {
      res.status(404).send({
         status: 404,
         message: 'The requested resource was not found',
      });
   });

   // 5xx
   app.use((err, req, res, next) => {
      console.error(err);
      res.status(500).send({
         status: 500,
         message: 'An unexpected error occurred',
      });
   });
}
