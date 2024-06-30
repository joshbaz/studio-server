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
      PORT: z.number({ message: 'PORT should be a number' }).default(4500),
      SECRETVA: z.string({ message: 'SECRETIVA is required' }),
      DO_SPACESENDPOINT: z.string({ message: 'Spaces endpoint is required' }),
      DO_SPACESBUCKET: z.string({ message: 'Spaces bucket name is required' }),
      DO_SPACEACCESSKEY: z.string({
         message: 'Spaces access key is required',
      }),
      DO_SPACESECRETKEY: z.string({
         message: 'Spaces secret key is required',
      }),
   },
   runtimeEnv: process.env,
});
