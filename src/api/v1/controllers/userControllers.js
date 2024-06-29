// import mongoose from 'mongoose';
// import adminModels from '../v1/0-models/admin.models.js';
import prisma from '@/utils/db.mjs';

export const updateUser = async (req, res, next) => {
   try {
      if (req.params.id === req?.userId) {
         const updated = await adminModels.findByIdAndUpdate(
            req.params.id,
            { $set: req.body },
            { new: true }
         );

         res.status(200).json(updated);
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

export const getUser = async (req, res, next) => {
   try {
      const user = await adminModels.findById(req.params.id);

      res.status(200).json(user);
   } catch (error) {
      if (!error.statusCode) {
         error.statusCode = 500;
      }
      next(error);
   }
};
export const deleteUser = async (req, res, next) => {
   try {
      if (req.params.id === req?.userId) {
         const updated = await adminModels.findByIdAndUpdate(
            req.params.id,
            { $set: req.body },
            { new: true }
         );

         res.clearCookie('token')
            .status(200)
            .json('User deactivated and set for deletion soon');
      } else {
         res.status(403).send('not authorized to delete this account');
      }
   } catch (error) {
      if (!error.statusCode) {
         error.statusCode = 500;
      }
      next(error);
   }
};
