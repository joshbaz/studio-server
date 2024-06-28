import express from 'express';
import {
   login,
   logout,
   register,
} from '../controllers/adminAuth.controllers.js';
import { body } from 'express-validator';
import AdminModel from '../models/admin.models.js';
import { verifyToken } from '../middleware/verifyToken.js';

const router = express.Router();

router.post(
   '/register',
   verifyToken,
   [
      body('email')
         .isEmail()
         .withMessage('Please insert a valid Email')
         .custom((value, { req }) => {
            return AdminModel.findOne({ email: value }).then((emails) => {
               if (emails) {
                  return Promise.reject('Email already exists!!');
               }
            });
         })
         .normalizeEmail(),
      body('password')
         .trim()
         .isLength({ min: 6 })
         .withMessage('Please check the passkey char length'),
   ],
   register
);
router.get('/login', (req, res) => {
   res.json({ message: 'login successful', name: 'admin', role: 'admin' });
});

router.post('/logout', logout);

router.post('/google', login);

export default router;
