import nodemailer from 'nodemailer';
import { env } from '@/env.mjs';



/**
 * @name sendMail
 * @param {nodemailer.SendMailOptions} mailOptions
 * @returns {Promise<nodemailer.SentMessageInfo>}
 */
export const sendMail = async (mailOptions) => {
   try {
      const transporter = nodemailer.createTransport({
         host: env.NODE_MAILER_HOST,
         port: 465,
         secure: true,
         auth: {
            user: env.NODE_MAILER_USERCRED,
            pass: env.NODE_MAILER_PASSCRED,
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
