import 'dotenv/config';

import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

export const env = createEnv({
   server: {
      DATABASE_URL: z.string({ message: 'DATABASE_URL is required' }),
      HAS_ENV: z
         .string({
            message: 'To start the server HAS_ENV must have a value',
         })
         .default(''),
      PORT: z
         .string({ message: 'PORT should be a number' })
         .optional()
         .default(4500),
      SECRETVA: z.string({ message: 'SECRETIVA is required' }),

      // Digital Ocean
      DO_SPACESENDPOINT: z.string({ message: 'Spaces endpoint is required' }),
      DO_SPACESBUCKET: z.string({ message: 'Spaces bucket name is required' }),
      DO_SPACEACCESSKEY: z.string({
         message: 'Spaces access key is required',
      }),
      DO_SPACESECRETKEY: z.string({
         message: 'Spaces secret key is required',
      }),
      CLIENT_URL: z.string().optional(),

      // Resend
      RESEND_API_KEY: z
         .string({ message: 'RESEND_API_KEY is required' })
         .optional(), // TODO: make this required
      RESEND_API_HOST: z
         .string({ message: 'RESEND_API_HOST is required' })
         .optional(),

      // Africas Talking SMS API
      AT_API_KEY: z.string({ message: 'AT_API_KEY is required' }),

      // Twilio SMS API
      TWILIO_ACCOUNT_SID: z.string({
         message: 'TWILIO_ACCOUNT_SID is required',
      }),
      TWILIO_AUTH_TOKEN: z.string({ message: 'TWILIO_AUTH_TOKEN is required' }),
      TWILIO_MESSAGING_SERVICE_SID: z.string({
         message: 'TWILIO_MESSAGING_SERVICE_SID is required',
      }),

      // Nodemailer
      NODE_MAILER_HOST: z.string({ message: 'HOST is required' }),
      NODE_MAILER_PORT: z.string({ message: 'PORTMAIL is required' }),
      NODE_MAILER_USERCRED: z.string({ message: 'USERCRED is required' }),
      NODE_MAILER_PASSCRED: z.string({ message: 'USERKEY is required' }),
   },
   runtimeEnv: process.env,
});
