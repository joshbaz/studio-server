import mongoose from "mongoose";
import adminModels from "../0-models/admin.models.js";

export const updateUser = async (req, res, next) => {
    try {
        if (req.params.id === req.userId) {
            const updated = await adminModels.findByIdAndUpdate(req.params.id, { $set: req.body }, { new: true });

            res.status(200).json(updated);
        } else {
              const error = new Error("not authorized to update this account");
              error.statusCode = 403;
              throw error;
        }
      //res.status(200).json("done")  
    } catch (error) {
         if (!error.statusCode) {
           error.statusCode = 500;
         }
         next(error);
    }
}

export const getUser = async (req, res, next) => {
  try {
    const user = await adminModels.findById(req.params.id);

      res.status(200).json(user)  
    } catch (error) {
         if (!error.statusCode) {
           error.statusCode = 500;
         }
         next(error);
    }
}
export const deleteUser= async (req, res, next) => {
  try {
     if (req.params.id === req.userId) {
            const updated = await adminModels.findByIdAndUpdate(req.params.id, { $set: req.body }, { new: true });

            res.clearCookie("token").status(200).json("User deactivated and set for deletion soon");
        } else {
              const error = new Error("not authorized to delete account");
              error.statusCode = 403;
              throw error;
        }
  } catch (error) {
    if (!error.statusCode) {
      error.statusCode = 500;
    }
    next(error);
  }
};