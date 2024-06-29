import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import Moments from 'moment-timezone';
import { validationResult } from 'express-validator';
import { env } from '@/env.mjs';
import prisma from '@/utils/db.mjs';

export const register = async (req, res, next) => {
   try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
         const error = errors.array().map((error) => error.msg)[0];
         return res.status(422).json({ message: error });
      }

      const {
         email,
         password,
         firstname,
         lastname,
         privileges,
         role,
         phoneNumber,
      } = req.body;
      const createdDate = Moments(new Date()).tz('Africa/Kampala');
      const hashedPassword = await bcrypt.hash(password, 10);

      const adminUser = await prisma.admin.create({
         data: {
            email,
            password: hashedPassword,
            firstname,
            lastname,
            privileges,
            role,
            phoneNumber,
            createdDate,
         },
      });

      return res.status(201).json({
         message: `administrator with email ${adminUser?.email} registered`,
      });
   } catch (error) {
      if (!error.statusCode) {
         error.statusCode = 500;
      }
      res.status(500).json({ message: 'Something went wrong' });
      next(error);
   }
};

export const login = async (req, res, next) => {
   try {
      const { email, password, staySigned } = req.body;

      const existingUser = await prisma.admin.findUnique({
         where: {
            email,
         },
      });

      if (!existingUser) {
         return res.status(404).json({ message: 'Invalid Credentials' });
      }

      if (existingUser.deactivated) {
         return res.status(404).json({ message: 'User deactivated' });
      }

      const comparePassword = await bcrypt.compare(
         password,
         existingUser.password
      );

      if (!comparePassword) {
         res.status(401).json({ message: 'Invalid Credentials' });
      }

      const token = jwt.sign(
         {
            email: existingUser.email,
            userId: existingUser.id,
         },
         env.SECRETVA,
         staySigned === false ? { expiresIn: '24h' } : { expiresIn: '30d' }
      );

      let age = 1000 * 60 * 60 * 24 * 7;

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
      res.status(500).json({ message: 'Something went wrong!!' });
      next(error);
   }
};

export const logout = (req, res, next) => {
   try {
      res.clearCookie('token')
         .status(200)
         .json({ message: 'Logout Successful' });
   } catch (error) {
      // if (!error.statusCode) {
      //    error.statusCode = 500;
      // }
      // next(error);
      res.status(500).json({ message: 'Something went wrong' });
   }
};
