import nodemailer from 'nodemailer';
import { env } from '@/env.mjs';

import dotenv from 'dotenv'
dotenv.config();


/**
 * @name sendMail
 * @param {nodemailer.SendMailOptions} mailOptions
 * @returns {Promise<nodemailer.SentMessageInfo>}
 */
export const sendMail = async (mailOptions) => {
   try {
      const transporter = nodemailer.createTransport({
         host: process.env.NODE_MAILER_HOST,
         port: 465,
         secure: true,
         auth: {
            user: process.env.NODE_MAILER_USERCRED,
            pass: process.env.NODE_MAILER_PASSCRED,
         },
      });
      const response = await transporter.sendMail(mailOptions);
      console.log('Message sent: %s', response.messageId);
      return response;
   } catch (error) {
      console.error(error);
      throw new Error('Failed to send email');
   }
};
