import Africastalking from 'africastalking';
import { env } from '@/env.mjs';

function initializeAT() {
   if (!env.AT_API_KEY) {
      throw new Error('AT_API_KEY is required');
   }

   try {
      const instance = Africastalking({
         apiKey: env.AT_API_KEY,
         username: 'sandbox',
      });

      return instance;
   } catch (error) {
      throw new Error('Something went wrong while initializing Africastalking');
   }
}

export const at = initializeAT();
