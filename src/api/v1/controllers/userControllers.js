// import mongoose from 'mongoose';
// import adminModels from '../v1/0-models/admin.models.js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { env } from '@/env.mjs';
import prisma from '@/utils/db.mjs';
import { validationResult } from 'express-validator';

/**
 *@name createUser
 *@description create a new user
 *@type {import('express').RequestHandler}
 */
export const createUser = async (req, res, next) => {
   try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
         const firstError = errors.array().map((error) => error.msg)[0];
         return res.status(422).json({ message: firstError });
      }

      const {
         email,
         password,
         firstname,
         lastname,
         username,
         role,
         phoneNumber,
      } = req.body;
      const hashedPassword = await bcrypt.hash(password, 10);

      const newUser = await prisma.user.create({
         data: {
            email,
            password: hashedPassword,
            firstname,
            lastname,
            username,
            role,
            phoneNumber,
         },
      });

      return res.status(201).json({
         message: `user with email ${newUser.email} created successfully`,
      });
   } catch (error) {
      res.status(500).json({
         message: error.message ?? 'Something went wrong',
      });
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

      const existingUser = await prisma.user.findUnique({
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

      if (!comparePassword) {
         return res.status(401).json({ message: 'Invalid Credentials' });
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

/**
 *@name updateUser
 *@description update a user by id
 *@type {import('express').RequestHandler}
 */
export const updateUser = async (req, res, next) => {
   try {
      if (req.params.id === req?.userId) {
         let updates = req.body;
         if (req.body.password) {
            updates.password = await bcrypt.hash(req.body.password, 10);
         }
         const updatedUser = await prisma.user.update({
            where: {
               id: req.params.id,
            },
            data: { ...updates },
         });

         const { password: Omit, ...userInfo } = updatedUser;

         res.status(200).json({ message: 'User updated', user: userInfo });
      } else {
         res.status(403).send('not authorized to update this account');
      }
      //res.status(200).json("done")
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
      res.status(200).json({ users: usersWithoutPassword });
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

/**
 *@name getUser
 *@description get a user by id
 *@type {import('express').RequestHandler}
 */
export const getUser = async (req, res, next) => {
   try {
      const user = await prisma.user.findUnique({
         where: {
            id: req.params.id,
         },
      });

      if (!user) {
         return res.status(404).json({ message: 'User not found' });
      }

      res.status(200).json({ user });
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

/**
 *@name deleteUser
 *@description delete a user by id
 *@type {import('express').RequestHandler}
 */
export const deleteUser = async (req, res, next) => {
   try {
      if (req.params.id === req?.userId) {
         const deletedUser = await prisma.user.delete({
            where: {
               id: req.params.id,
            },
         });

         res.clearCookie('token')
            .status(200)
            .json({
               message: `${deletedUser?.firstname}'s account successfully deleted`,
            });
      } else {
         res.status(403).send('You can not delete this account.');
      }
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
