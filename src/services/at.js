import Africastalking from 'africastalking';
import { env } from '@/env.mjs';

export const at = Africastalking({
   apiKey: env.AT_API_KEY,
   username: 'sandbox',
});
