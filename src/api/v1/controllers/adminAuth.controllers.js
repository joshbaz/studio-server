import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import Moments from 'moment-timezone';
import AdminModel from '../models/admin.models.js';
import { validationResult } from 'express-validator';
import { env } from '../../../env.mjs';

export const register = async (req, res, next) => {
   try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
         // const error = new Error('Validation failed');
         // error = 422;
         // error.message = errors.errors[0].msg;
         // throw error;
         return res.status(422).json({ message: 'Validation failed' });
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

      const adminUser = new AdminModel({
         _id: new mongoose.Types.ObjectId(),
         email,
         password: hashedPassword,
         firstname,
         lastname,
         privileges,
         role,
         phoneNumber,
         createdDate,
      });

      await adminUser.save();

      res.status(201).json(`administrator with email ${email} registered`);
   } catch (error) {
      // if (!error.statusCode) {
      //    error.statusCode = 500;
      // }
      res.status(500).json({ message: 'Something went wrong' });
      next(error);
   }
};

export const login = async (req, res, next) => {
   try {
      const { username, password, staySigned } = req.body;

      const findOneUser = await AdminModel.findOne({ email: username });
      if (!findOneUser) {
         // const error = new Error('Invalid Credentials - e');
         // error.statusCode = 404;
         // throw error;

         return res.status(404).json({ message: 'Invalid Credentials' });
      }

      // console.log("user", outputUser);

      if (findOneUser.deactivated) {
         // const error = new Error('User deactivated');
         // error.statusCode = 404;
         // throw error;
         return res.status(404).json({ message: 'User deactivated' });
      }

      const comparePassword = await bcrypt.compare(
         password,
         findOneUser.password
      );

      if (!comparePassword) {
         // const error = new Error('Invalid Credentials - p');
         // error.statusCode = 401;
         // throw error;
         res.status(401).json({ message: 'Invalid Credentials' });
      }

      const token = jwt.sign(
         {
            email: findOneUser.email,
            userId: findOneUser._id,
         },
         env.SECRETVA,
         staySigned === false ? { expiresIn: '24h' } : { expiresIn: '30d' }
      );

      console.log('token', token);
      // res.status(200).json({
      //   token: token,
      //   id: findOneUser._id.toString(),
      //   email: findOneUser.email,
      //   firstname: findOneUser.firstname,
      //   lastname: findOneUser.lastname,
      //   privileges: findOneUser.privileges,
      //   });

      //   res.setHeader("Set-Cookie", "test=" + "myValue").json("success");
      let age = 1000 * 60 * 60 * 24 * 7;

      const { ...userInfo } = findOneUser;

      let { password: userPassword, ...outputUser } = userInfo; //userInfo?._doc;
      res.cookie('token', token, {
         httpOnly: true,
         //secure: true,
         maxAge: age,
      })
         .status(200)
         .json(outputUser);
   } catch (error) {
      // if (!error.statusCode) {
      //    error.statusCode = 500;
      // }
      // next(error);
      res.status(500).json({ message: 'Something went wrong' });
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
