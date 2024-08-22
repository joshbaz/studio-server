import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import Moments from 'moment-timezone';
import { validationResult } from 'express-validator';
import { env } from '@/env.mjs';
import prisma from '@/utils/db.mjs';

/**
 *@name register
 *@description register a new admin
 *@type {import('express').RequestHandler}
 */
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

/**
 *@name login
 *@description login a user
 *@type {import('express').RequestHandler}
 */
export const login = async (req, res, next) => {
   try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
         const error = errors.array().map((error) => error.msg)[0];
         const err = new Error(error);
         err.statusCode = 422;
         throw err;
      }

      const { email, password, staySigned } = req.body;

      const existingUser = await prisma.admin.findUnique({
         where: {
            email,
         },
      });

      if (!existingUser) {
         const error = new Error('Invalid Credentials');
         error.statusCode = 400;
         throw error;
      }

      if (existingUser.deactivated) {
         const error = new Error('User deactivated');
         error.statusCode = 400;
         throw error;
      }

      const comparePassword = await bcrypt.compare(
         password,
         existingUser.password
      );

      if (!comparePassword) {
         const error = new Error('Invalid Credentials');
         error.statusCode = 401;
         throw error;
      }

      const token = jwt.sign(
         {
            email: existingUser.email,
            id: existingUser.id,
         },
         env.SECRETVA,
         staySigned === false ? { expiresIn: '24h' } : { expiresIn: '30d' }
      );

      let age = 1000 * 60 * 60 * 24 * 7;

      const { password: Omit, ...userInfo } = existingUser;

      res.cookie('token', token, {
         httpOnly: true,
         secure: process.env.NODE_ENV === 'production',
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
 *@name getProfile
 *@description get a admin profile
 *@type {import('express').RequestHandler}
 */
export const getProfile = async (req, res, next) => {
   try {
      const { adminId } = req.params;

      if (!adminId)
         return res.status(400).json({ message: 'Admin id not passed' });

      const admin = await prisma.admin.findUnique({
         where: {
            id: adminId,
         },
         select: {
            id: true,
            email: true,
            firstname: true,
            lastname: true,
            phoneNumber: true,
            role: true,
            privileges: true,
            createdDate: true,
         },
      });

      if (!admin) {
         return res.status(404).json({ message: 'Admin not found' });
      }

      return res.status(200).json({ admin });
   } catch (error) {
      if (!error.statusCode) {
         error.statusCode = 500;
      }
      next(error);
      res.status(500).json({ message: 'Something went wrong!!' });
      next(error);
   }
};

/**
 *@name logout
 *@description logout a user
 *@type {import('express').RequestHandler}
 */
export const logout = async (req, res, next) => {
   try {
      const { id } = req.params;
      if (!id || !req.userId)
         return res.status(400).json({ message: 'Admin id not passed' });
      if (req.userId !== id)
         return res
            .status(401)
            .json({ message: 'You can not perform this action' });
      res.clearCookie('token').status(200).json({ message: 'Logged out' });
   } catch (error) {
      if (!error.statusCode) {
         error.statusCode = 500;
      }
      next(error);
      res.status(500).json({ message: 'Something went wrong!!' });
      next(error);
   }
};
