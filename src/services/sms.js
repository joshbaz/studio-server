import Africastalking from 'africastalking';
import { env } from '@/env.mjs';
import twilio from 'twilio';

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

// Setup Twilio SMS
const twilioClient = twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);

export const twilio = twilioClient;
