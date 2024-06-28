import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

export const env = createEnv({
   server: {
      DATABASE_URL: z.string({ message: 'DATABASE_URL is required' }).min(1),
      HAS_ENV: z
         .string({
            message: 'To start the server HAS_ENV must have a value',
         })
         .default(''),
      PORT: z.number({ message: 'PORT should be a number' }).default(4500),
   },
   runtimeEnv: process.env,
});
