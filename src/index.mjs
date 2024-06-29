import express from 'express';

import http from 'http';
import { env } from '@src/env.mjs';
import customizeApp from '@src/app.mjs';

let server;
const app = express();

app.start = async () => {
   console.log('Starting server... ⚙');

   const signals = ['SIGINT', 'SIGTERM', 'SIGQUIT'];

   signals.forEach((signal) => process.on(signal, process.exit)); // stop the server on signals

   const port = env.PORT || 4500;
   app.set('port', port);

   customizeApp(app);

   server = http.createServer(app);

   server.on('error', (error) => {
      if (error.syscall !== 'listen') {
         throw error;
      }
      console.error('Failed to start server', error);
      process.exit(15);
   });

   server.on('listening', () => {
      // validate env...
      const hasEnv = env.HAS_ENV;

      if (!hasEnv) {
         throw new Error('To start the server make sure HAS_ENV is true');
      }

      const addr = server.address();
      const bind =
         typeof addr === 'string' ? `pipe ${addr}` : `port ${addr?.port}`;
      console.log(`Server listening on ${bind}`);
      console.info('Server started ✅');

      //TODO: find a way to log this in production
   });

   if (process.env.NODE_ENV !== 'test') {
      server.listen(port);
   }
};

Promise.resolve(true)
   .then(app.start)
   .catch((err) => {
      console.error(err);
      setTimeout(() => process.exit(15), 1000); // graceful exit
   });

export default app;
