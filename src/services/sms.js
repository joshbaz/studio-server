import Africastalking from 'africastalking';
import { env } from '../env.mjs';
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

/**
   @name sendSMS
   @description Send SMS with Twilio
   @param {{
      to: string
      message: string;
   }} params {to, message} - Phone number to send the message to and the message to send
  
   @returns {Promise<import('twilio').RestApi>}
*/
export const sendSMS = async ({ to, message }) => {
   try {
      const response = await twilioClient.messages.create({
         to,
         body: message,
         messagingServiceSid: env.TWILIO_MESSAGING_SERVICE_SID,
      });

      return response;
   } catch (error) {
      throw new Error(error.message);
   }
};
