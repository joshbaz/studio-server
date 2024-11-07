import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { env } from '@/env.mjs';
import prisma from '@/utils/db.mjs';
import { resend } from '@/services/resend.js';
import { at, sendSMS } from '@/services/sms.js';
import { generate as generateOtp } from 'otp-generator';
import { renderVerificationTemplate } from '@/services/emailTemplates.js';
import { returnError } from '@/utils/returnError.js';

/**
 *@name createUser
 *@description create a new user
 *@type {import('express').RequestHandler}
 */
export const createUser = async (req, res, next) => {
   try {
      const {
         email,
         password,
         firstName,
         lastName,
         username,
         role,
         isEmail,
         phoneNumber,
      } = req.body;

      if (!isEmail) {
         // check user using phone number
         const user = await prisma.user.findFirst({
            where: {
               phoneNumber: phoneNumber,
            },
         });

         if (user) {
            return res
               .status(400)
               .json({ message: 'Something went wrong, try again' });
         }
      } else {
         const user = await prisma.user.findFirst({
            where: {
               email: email,
            },
            select: {
               email: true,
               id: true,
               firstname: true,
               lastname: true,
            },
         });

         if (user) {
            return res.status(400).json({ message: 'Something went wrong' });
         }
      }
      const hashedPassword = await bcrypt.hash(password, 10);

      const newUser = await prisma.user.create({
         data: {
            email,
            password: hashedPassword,
            firstname: firstName,
            lastname: lastName,
            username,
            role,
            phoneNumber,
         },
      });

      return res.status(201).json({
         message: `User created successfully`,
      });
   } catch (error) {
      if (!error.statusCode) {
         error.statusCode = 500;
      }
      next(error);
   }
};

/**
 *@name loginUser
 *@description create a new user
 *@type {import('express').RequestHandler}
 */
export const loginUser = async (req, res, next) => {
   try {
      const { email, password, staySigned } = req.body;

      const existingUser = await prisma.user.findFirst({
         where: {
            email,
         },
      });

      if (!existingUser) {
         return res.status(404).json({ message: 'Invalid Credentials' });
      }

      const comparePassword = await bcrypt.compare(
         password,
         existingUser.password
      );

      if (!comparePassword) returnError('Invalid Credentials', 400);

      const token = jwt.sign(
         {
            email: existingUser.email,
            id: existingUser.id,
         },
         env.SECRETVA,
         staySigned === false ? { expiresIn: '24h' } : { expiresIn: '30d' }
      );

      let age =
         staySigned === false ? 1000 * 60 * 60 * 24 : 1000 * 60 * 60 * 24 * 30; // 24 hours or 30 days
      const { password: Omit, ...userInfo } = existingUser;

      res.cookie('token', token, {
         httpOnly: true,
         //secure: true,
         maxAge: age,
      })
         .status(200)
         .json({ user: userInfo, token: token });
   } catch (error) {
      if (!error.statusCode) {
         error.statusCode = 500;
      }

      next(error);
   }
};

/**
 *@name logout
 *@description logout user
 *@type {import('express').RequestHandler}
 */
export const logout = async (req, res, next) => {
   try {
      const { id } = req.params;
      if (!id || !req.userId) {
         returnError('User id not passed', 400);
      }
      if (req.userId !== id) {
         returnError('Unauthorized', 401);
      }

      res.clearCookie('token');

      return res.status(200).json({ message: 'Logged out' });
   } catch (error) {
      if (!error.statusCode) {
         error.statusCode = 500;
      }
      next(error);
   }
};

/**
 *@name updateUser
 *@description update a user by id
 *@type {import('express').RequestHandler}
 */
export const updateUser = async (req, res, next) => {
   try {
      if (!req.params.id) {
         returnError('Failed to update user', 400);
      }

      // only the user can update their account
      if (req.userId !== req.params.id) {
         returnError('Unauthorized', 403);
      }

      let updates = req.body;
      if (req.body.password) {
         updates.password = await bcrypt.hash(req.body.password, 10);
      }

      const updatedUser = await prisma.user.update({
         where: {
            id: req.params.id,
         },
         data: { ...updates },
         select: {
            id: true,
            email: true,
            firstname: true,
            username: true,
            lastname: true,
            phoneNumber: true,
            createdAt: true,
            accountVerified: true,
         },
      });

      res.status(200).json({ message: 'User updated', user: updatedUser });
   } catch (error) {
      if (!error.statusCode) {
         error.statusCode = 500;
      }
      next(error);
   }
};

/**
 *@name getUsers
 *@description get a user by id
 *@type {import('express').RequestHandler}
 */
export const getUsers = async (_, res, next) => {
   try {
      const users = await prisma.user.findMany();
      const usersWithoutPassword = users.map((user) => {
         const { password: Omit, ...userInfo } = user;
         return userInfo;
      });

      return res.status(200).json({ users: usersWithoutPassword });
   } catch (error) {
      if (!error.statusCode) {
         error.statusCode = 500;
      }
      next(error);
   }
};

/**
 *@name getUserProfile
 *@description get a user profile
 *@type {import('express').RequestHandler}
 */
export const getUserProfile = async (req, res, next) => {
   try {
      const { userId } = req.params;

      if (!userId) returnError('User id not passed', 400);

      const user = await prisma.user.findUnique({
         where: {
            id: userId,
         },
         select: {
            id: true,
            email: true,
            firstname: true,
            username: true,
            lastname: true,
            phoneNumber: true,
            createdAt: true,
            accountVerified: true,
         },
      });

      if (!user) returnError('User not found', 404);

      return res.status(200).json({ user });
   } catch (error) {
      if (!error.statusCode) {
         error.statusCode = 500;
      }
      next(error);
   }
};

/**
 *@name getUser
 *@description get a user by id
 *@type {import('express').RequestHandler}
 */
export const getUser = async (req, res, next) => {
   try {
      if (!req.params.id) returnError('User id not passed', 400);

      const user = await prisma.user.findFirst({
         where: {
            id: req.params.id,
         },
      });

      if (!user) returnError('User not found', 404);

      res.status(200).json({ user });
   } catch (error) {
      if (!error.statusCode) {
         error.statusCode = 500;
      }

      next(error);
   }
};

/**
 *@name deleteUser
 *@description delete a user by id
 *@type {import('express').RequestHandler}
 */
export const deleteUser = async (req, res, next) => {
   try {
      if (!req.params.id) returnError('User id not passed', 400);

      // only the user can delete their account
      if (req.userId !== req.params.id) returnError('Unauthorized', 403);

      // delete the user
      const deletedUser = await prisma.user.delete({
         where: {
            id: req.params.id,
         },
         select: {
            id: true,
            email: true,
            firstname: true,
            username: true,
         },
      });

      res.clearCookie('token')
         .status(200)
         .json({
            message: `${deletedUser?.firstname}'s account successfully deleted`,
         });

      res.status(200).send({ message: 'User deleted', user: deletedUser });
   } catch (error) {
      if (!error.statusCode) {
         error.statusCode = 500;
      }

      next(error);
   }
};

/**
 *@name sendOTP
 *@description Send OTP code to user via email or phone number
 *@type {import('express').RequestHandler}
 */
export const sendOTP = async (req, res, next) => {
   try {
      const { contact, isEmail } = req.body;
      if (!contact) {
         return res.status(400).json({
            message:
               'An issue occured while requesting and OTP, check your details and try again',
         });
      }

      // verify that the user exists
      let params = {
         email: contact,
      };
      if (!isEmail) {
         params = { phoneNumber: contact };
      }

      const user = await prisma.user.findFirst({
         where: params,
      });

      if (!user) {
         return res.status(404).json({
            message:
               'An issue occured while requesting and OTP, check your details and try again',
         });
      }

      // generate an OTP and save it to the database
      const otp = generateOtp(4, {
         upperCaseAlphabets: false,
         lowerCaseAlphabets: false,
         digits: true,
         specialChars: false,
      });

      if (!otp) {
         return res.status(500).json({
            message: 'Something went wrong while generating your code',
         });
      }

      // check if if there are other OTPs for the same user and delete them
      await prisma.otp.deleteMany({
         where: {
            userId: user.id,
         },
      });

      const otpfromDb = await prisma.otp.create({
         data: {
            otp,
            userId: user.id,
            expiresAt: new Date(Date.now() + 1000 * 60 * 15), // 15 minutes
         },
      });

      let response;
      if (isEmail) {
         response = await resend.emails.send({
            from: 'noreply@mbuguanewton.dev',
            to: contact,
            subject: 'Your Nyati Motion Pictures OTP login Code',
            html: renderVerificationTemplate(otp),
         });

         if (response?.error) {
            throw new Error(response.error);
         }
      } else {
         // use something lile Africas Talking SMS API
         // response = await at.SMS.send({
         //    from: 'Nyati', // short code for Nyati
         //    to: contact,
         //    message: `Your Nyati OTP login Code is ${otp}`,
         // });

         // Send SMS with Twilio
         response = await sendSMS({
            to: contact,
            message: `Your Nyati OTP login Code is ${otp}`,
         });

         if (response.error) {
            throw new Error(response.error);
         }
      }

      // create a temporary token for the user to verify the OTP
      const token = jwt.sign(
         {
            contact,
            userId: user.id,
            otpId: otpfromDb.id,
         },
         env.SECRETVA,
         { expiresIn: '10m' }
      );

      res.cookie('otp-token', token, {
         httpOnly: true,
         maxAge: 1000 * 60 * 10,
      }); // 10 minutes

      return res.status(200).json({
         message: 'OTP sent please check your email',
         otpToken: token,
      });
   } catch (error) {
      if (!error.statusCode) {
         error.statusCode = 500;
      }
      res.status(500).json({
         message: error.message ?? 'Something went wrong',
      });
      return;
   }
};

/**
 *@name verifyOTP
 *@description verify OTP
 *@type {import('express').RequestHandler}
 */
export const verifyOTP = async (req, res, next) => {
   try {
      const { otp, contact, isEmail } = req.body;
      if (!otp || !contact) {
         return res.status(400).json({
            message:
               'An issue occured while requesting and OTP, check your details and try again',
         });
      }

      // get the token from the cookie
      const token = req.cookies['otp-token'];
      if (!token) {
         return res.status(400).json({
            message:
               'An issue occured while requesting and OTP, check your details and try again',
         });
      }

      const payload = jwt.verify(token, env.SECRETVA);
      const userId = payload.userId;

      const otpFromDb = await prisma.otp.findFirst({
         where: {
            otp,
            userId,
         },
      });

      if (!otpFromDb) {
         return res.status(404).json({
            message:
               'An issue occured while requesting and OTP, check your details and try again',
         });
      }

      // check if the otp is expired
      if (otpFromDb.expiresAt < new Date()) {
         return res.status(401).json({
            message:
               'An issue occured while requesting and OTP, check your details and try again',
         });
      }

      await prisma.otp.delete({
         where: {
            id: otpFromDb.id,
         },
      });

      // delete the cookie
      res.clearCookie('otp-token');

      // login the user and generate an auth token
      const existingUser = await prisma.user.findFirst({
         where: {
            id: userId,
         },
      });

      const authToken = jwt.sign(
         {
            email: existingUser.email,
            id: existingUser.id,
         },
         env.SECRETVA,
         { expiresIn: '24h' }
      );

      res.cookie('token', authToken, {
         httpOnly: true,
         maxAge: 1000 * 60 * 60 * 24, // 24 hours
      });

      return res
         .status(200)
         .json({ message: 'OTP verified successfully', token: authToken });
   } catch (error) {
      if (!error.statusCode) {
         error.statusCode = 500;
      }
      res.status(500).json({
         message: error.message ?? 'Something went wrong',
      });
      next(error);
   }
};

export const testEmailOTP = async (req, res, next) => {
   try {
      const otp = generateOtp(6, {
         upperCaseAlphabets: false,
         lowerCaseAlphabets: false,
         digits: true,
         specialChars: false,
      });

      const response = await resend.emails.send({
         from: 'noreply@mbuguanewton.dev',
         to: 'mymbugua@gmail.com',
         subject: 'Your Nyati Motion Pictures Verification Code',
         html: renderVerificationTemplate(otp),
      });

      if (response?.error) {
         throw new Error(response.error);
      }

      return res.status(200).json({
         message: 'OTP sent please check your email',
      });
   } catch (error) {
      console.log('Error', error);
      if (!error.statusCode) {
         error.statusCode = 500;
      }

      next(error);
   }
};

export const testSMSOTP = async (req, res, next) => {
   try {
      const otp = generateOtp(4, {
         upperCaseAlphabets: false,
         lowerCaseAlphabets: false,
         digits: true,
         specialChars: false,
      });

      const response = await sendSMS({
         to: '+254716390878',
         message: `Your Nyati OTP login Code is ${otp}`,
      });

      console.log(response);

      if (response.error) {
         throw new Error(response.error);
      }

      return res.status(200).json({
         message: 'OTP sent please check your phone',
      });
   } catch (error) {
      console.log('Error', error.message);
      if (!error.statusCode) {
         error.statusCode = 500;
      }

      next(error);
   }
};
