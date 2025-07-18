import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { env } from '@/env.mjs';
import prisma from '@/utils/db.mjs';
// import { resend } from '@/services/resend.js';
import { sendZohoMail } from '@/services/zohoMail.js';
import { at, sendSMS } from '@/services/sms.js';
import { generate as generateOtp } from 'otp-generator';
import {
    renderVerificationTemplate,
    renderConfirmationTemplate,
    renderConfirmPassChange,
} from '@/services/emailTemplates.js';
import { returnError } from '@/utils/returnError.js';
import crypto from 'crypto';
import nodemailer from 'nodemailer';

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
        } = req.data;

        if (!isEmail) {
            // check user using phone number
            const user = await prisma.user.findFirst({
                where: {
                    phoneNumber: phoneNumber,
                },
            });

            if (user) returnError('Something went wrong', 400);
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

            if (user) returnError('Something went wrong', 400);
        }
        const hashedPassword = await bcrypt.hash(password, 10);

        await prisma.user.create({
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
        const { email, password, staySigned } = req.data;

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
            staySigned === false
                ? 1000 * 60 * 60 * 24
                : 1000 * 60 * 60 * 24 * 30; // 24 hours or 30 days
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
        await prisma.user.delete({
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

        return res.clearCookie('token').status(200).json({
            message: `Account successfully deleted`,
        });
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
        const { contact, isEmail, type } = req.data; // otp type could be auth or forgotpassword

        if (!contact) {
            returnError('Contact not passed', 400);
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
            returnError('User not found', 404);
        }

        // generate an OTP and save it to the database
        const otp = generateOtp(4, {
            upperCaseAlphabets: false,
            lowerCaseAlphabets: false,
            digits: true,
            specialChars: false,
        });

        if (!otp) {
            returnError('Something went wrong while generating your code', 400);
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
            response = await sendZohoMail({
                to: contact,
                subject:
                    type === 'auth'
                        ? 'Your Nyati Motion Pictures OTP login Code'
                        : 'Your Nyati Motion Pictures OTP Password Reset Code',
                html: renderVerificationTemplate(otp),
            });
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
                message:
                    type === 'auth'
                        ? `Your Nyati OTP login Code is ${otp}`
                        : `Your Nyati OTP Password Reset Code is ${otp}`,
            });

            if (response.error) {
                throw new Error(response.error);
            }
        }

        // create a temporary token for the user to verify the OTP
        const token = jwt.sign(
            {
                contact,
                id: user.id,
                otpId: otpfromDb.id,
            },
            env.SECRETVA,
            { expiresIn: '10m' }
        );

        return res.status(200).json({
            message: isEmail
                ? 'OTP sent please check your email'
                : 'OTP sent please check your phone',
            otpToken: token, // set it as a bearer token in the frontend
        });
    } catch (error) {
        if (!error.statusCode) {
            error.statusCode = 500;
        }
        next(error);
    }
};

/**
 *@name verifyOTP
 *@description verify OTP
 *@type {import('express').RequestHandler}
 */
export const verifyOTP = async (req, res, next) => {
    try {
        const { otp, contact, type } = req.data; // type could be auth or resetpassword

        if (!otp || !contact) {
            returnError('An issue occured while requesting and OTP', 400);
        }

        // check if the user exists
        const user = await prisma.user.findFirst({
            where: { id: req.userId },
        });

        if (!user) {
            returnError('An issue occured while verifying OTP', 404);
        }

        const otpFromDb = await prisma.otp.findFirst({
            where: {
                otp,
                userId: user.id,
            },
        });

        if (!otpFromDb) {
            returnError(
                'An issue occured while verifying OTP, try again!',
                400
            );
        }

        // check if the otp is expired
        if (otpFromDb.expiresAt < new Date()) {
            returnError('The OTP has expired, request another one', 401);
        }

        await prisma.otp.delete({
            where: {
                id: otpFromDb.id,
            },
        });

        switch (type) {
            case 'auth':
                // update user as verified if the user exists
                await prisma.user.update({
                    where: { id: user.id },
                    data: {
                        accountVerified: true,
                    },
                });

                const authToken = jwt.sign(
                    {
                        email: user.email,
                        id: user.id,
                    },
                    env.SECRETVA,
                    { expiresIn: '24h' }
                );

                await sendZohoMail({
                    to: user.email,
                    subject: 'Nyatiflix Account Confirmation.',
                    html: renderConfirmationTemplate({
                        firstname: user.firstname,
                        email: user.email,
                    }),
                });
                res.status(200).json({
                    token: authToken,
                    message: 'OTP verified successfully',
                });
                break;
            case 'forgotpassword':
                const token = jwt.sign(
                    {
                        email: user.email,
                        id: user.id,
                    },
                    env.SECRETVA,
                    { expiresIn: '15m' }
                );

                res.status(200).json({
                    authToken: token, // set it as a bearer token in the frontend
                    message: 'OTP verified successfully',
                });
                break;
            default:
                returnError(
                    "Type must either be 'auth' or 'resetpassword'",
                    400
                );
                break;
        }
        // delete the cookie
    } catch (error) {
        if (!error.statusCode) {
            error.statusCode = 500;
        }

        next(error);
    }
};

/**
 *@name forgotPassword
 *@description function to reset password of a user
 *@type {import('express').RequestHandler}
 */
export const forgotPassword = async (req, res, next) => {
    try {
        const { newPassword } = req.data;

        if (!req.userId) returnError('User Id not provided', 400);

        // verify that the user exists
        const user = await prisma.user.findFirst({
            where: { id: req.userId },
        });

        if (!user) returnError('User does not exist', 404);

        // hash the new password
        const hashedNewPassword = await bcrypt.hash(newPassword, 10);

        // update the user's password
        await prisma.user.update({
            where: { id: user.id },
            data: { password: hashedNewPassword },
        });

        // send confirmation email
        await sendZohoMail({
            to: user.email,
            subject: 'Nyatiflix Password Reset Successful.',
            html: renderConfirmPassChange({
                email: user.email,
                firstname: user.firstname,
            }),
        });

        // send success message
        res.status(200).json({
            message: 'Password changed successfully',
        });
    } catch (error) {
        if (!error.statusCode) {
            error.statusCode = 500;
        }
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

        // const response = await resend.emails.send({
        //    from: 'noreply@mbuguanewton.dev',
        //    to: 'mymbugua@gmail.com',
        //    subject: 'Your Nyati Motion Pictures Verification Code',
        //    html: renderVerificationTemplate(otp),
        // });

        const response = await sendZohoMail({
            to: 'mymbugua@gmail.com',
            subject: 'Your Nyati Motion Pictures Verification Code',
            html: renderVerificationTemplate(otp),
        });
        // const response = await sendMail({
        //    from: 'Nyati Motion Pictures <no-reply@nyatimotionpictures.com>',
        //    to: 'mymbugua@gmail.com',
        //    subject: 'Nyatiflix Account Confirmation.',
        //    html: renderConfirmationTemplate({
        //       firstname: 'Newton',
        //       email: 'mymbugua@gmail.com',
        //    }),
        // });

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
            to: '+447494761694',
            message: `Your Nyati OTP login Code is ${otp}`,
        });

        console.log('Response', response);

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

/**
 *@name sendVerificationEmail
 *@description Send a verification email with a link to verify the user's account
 *@type {import('express').RequestHandler}
 */
export const sendVerificationEmail = async (req, res, next) => {
    try {
        const { email } = req.body;
        if (!email) returnError('Email is required', 400);
        const user = await prisma.user.findFirst({ where: { email } });
        if (!user) returnError('User not found', 404);
        if (user.accountVerified) {
            return res.status(400).json({ message: 'Account already verified.' });
        }

        // Generate a unique token
        const token = crypto.randomBytes(32).toString('hex');
        const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24); // 24 hours

        // Remove any existing tokens for this user
        await prisma.verificationToken.deleteMany({ where: { userId: user.id } });

        // Save the new token
        await prisma.verificationToken.create({
            data: {
                token,
                userId: user.id,
                expiresAt,
            },
        });

        // Construct verification link
        const verificationLink = `https://stream.nyatimotionpictures.com/verifyaccount?token=${token}`;

        // Send the email via Zoho Mail API
        await sendZohoMail({
            to: email,
            from: 'no-reply@nyatimotionpictures.com',
            subject: 'Verify your Nyati account',
            html: `
                <div style="font-family: Arial, sans-serif; background: #f8f8f8; padding: 32px;">
                    <div style="max-width: 480px; margin: 0 auto; background: #fff; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.04); padding: 32px;">
                        <div style="text-align: center;">
                            <img src="https://nyatimotionpictures.com/logo.png" alt="Nyati Motion Pictures" style="width: 120px; margin-bottom: 24px;" />
                        </div>
                        <h2 style="color: #222; text-align: center;">Verify your Nyati account</h2>
                        <p style="font-size: 16px; color: #444; text-align: center;">
                            Thank you for signing up with Nyati Motion Pictures!<br>
                            Please verify your email address to activate your account.
                        </p>
                        <div style="text-align: center; margin: 32px 0;">
                            <a href="${verificationLink}" style="background: #e50914; color: #fff; text-decoration: none; padding: 14px 32px; border-radius: 4px; font-size: 16px; font-weight: bold; display: inline-block;">
                                Verify Account
                            </a>
                        </div>
                        <p style="font-size: 14px; color: #888; text-align: center;">
                            Or copy and paste this link into your browser:<br>
                            <span style="word-break: break-all; color: #555;">${verificationLink}</span>
                        </p>
                        <hr style="margin: 32px 0; border: none; border-top: 1px solid #eee;">
                        <p style="font-size: 13px; color: #aaa; text-align: center;">
                            If you did not request this, please ignore this email.<br>
                            &copy; ${new Date().getFullYear()} Nyati Motion Pictures
                        </p>
                    </div>
                </div>
            `
        });

        res.status(200).json({ message: 'Verification email sent' });
    } catch (error) {
        if (!error.statusCode) error.statusCode = 500;
        next(error);
    }
};

/**
 *@name verifyAccount
 *@description Verify a user's account using the token from the verification link
 *@type {import('express').RequestHandler}
 */
export const verifyAccount = async (req, res, next) => {
    try {
        const { token } = req.query;
        if (!token) returnError('Verification token is required', 400);

        // Find the token
        const record = await prisma.verificationToken.findFirst({
            where: { token },
            include: { user: true },
        });

        if (!record || record.expiresAt < new Date()) {
            returnError('Invalid or expired verification token', 400);
        }

        // If already verified, return info
        if (record.user.accountVerified) {
            return res.status(400).json({ message: 'Account has already been verified.' });
        }

        // Mark user as verified
        await prisma.user.update({
            where: { id: record.userId },
            data: { accountVerified: true },
        });

        // Delete the token
        await prisma.verificationToken.delete({ where: { id: record.id } });

        res.status(200).json({ message: 'Account verified successfully' });
    } catch (error) {
        if (!error.statusCode) error.statusCode = 500;
        next(error);
    }
};

/**
 *@name sendPasswordResetEmail
 *@description Send a password reset email with a link to reset the user's password
 *@type {import('express').RequestHandler}
 */
export const sendPasswordResetEmail = async (req, res, next) => {
    try {
        const { email } = req.body;
        if (!email) returnError('Email is required', 400);
        const user = await prisma.user.findFirst({ where: { email } });
        if (!user) returnError('User not found', 404);

        // Generate a unique token
        const token = crypto.randomBytes(32).toString('hex');
        const expiresAt = new Date(Date.now() + 1000 * 60 * 60); // 1 hour

        // Remove any existing tokens for this user
        await prisma.passwordResetToken.deleteMany({ where: { userId: user.id } });

        // Save the new token
        await prisma.passwordResetToken.create({
            data: {
                token,
                userId: user.id,
                expiresAt,
            },
        });

        // Construct reset link
        const resetLink = `https://stream.nyatimotionpictures.com/resetpasskey?token=${token}`;

        // Send the email using Zoho with a proper template
        await sendZohoMail({
            to: email,
            from: 'no-reply@nyatimotionpictures.com',
            subject: 'Reset your Nyati account password',
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; background: #fff; border-radius: 8px; border: 1px solid #eee; box-shadow: 0 2px 8px rgba(0,0,0,0.04);">
                    <div style="background: #1a1a1a; color: #fff; padding: 24px 32px; border-radius: 8px 8px 0 0;">
                        <h2 style="margin: 0; font-size: 1.5em;">Nyati Motion Pictures</h2>
                    </div>
                    <div style="padding: 32px;">
                        <h3 style="margin-top: 0;">Reset Your Password</h3>
                        <p>Hello${user.firstname ? ` ${user.firstname}` : ''},</p>
                        <p>We received a request to reset your Nyati account password.</p>
                        <p>
                            <a href="${resetLink}" style="display: inline-block; padding: 12px 24px; background: #e50914; color: #fff; border-radius: 4px; text-decoration: none; font-weight: bold;">
                                Reset Password
                            </a>
                        </p>
                        <p style="color: #888; font-size: 0.95em;">
                            Or copy and paste this link into your browser:<br>
                            <span style="word-break: break-all;">${resetLink}</span>
                        </p>
                        <p>If you did not request a password reset, you can safely ignore this email.</p>
                        <p style="margin-bottom: 0;">Best regards,<br>The Nyati Team</p>
                    </div>
                    <div style="background: #fafafa; color: #888; text-align: center; font-size: 0.9em; padding: 16px; border-radius: 0 0 8px 8px;">
                        &copy; ${new Date().getFullYear()} Nyati Motion Pictures. All rights reserved.
                    </div>
                </div>
            `
        });

        res.status(200).json({ message: 'Password reset email sent' });
    } catch (error) {
        if (!error.statusCode) error.statusCode = 500;
        next(error);
    }
};

/**
 *@name resetPassword
 *@description Reset a user's password using the token from the reset link
 *@type {import('express').RequestHandler}
 */
export const resetPassword = async (req, res, next) => {
    try {
        const { token, newPassword } = req.body;
        if (!token || !newPassword) returnError('Token and new password are required', 400);

        // Find the token
        const record = await prisma.passwordResetToken.findFirst({
            where: { token },
            include: { user: true },
        });

        if (!record || record.expiresAt < new Date()) {
            returnError('Invalid or expired password reset token', 400);
        }

        // Hash the new password
        const hashedPassword = await bcrypt.hash(newPassword, 10);

        // Update the user's password
        await prisma.user.update({
            where: { id: record.userId },
            data: { password: hashedPassword },
        });

        // Send confirmation email
        await sendZohoMail({
            to: record.user.email,
            from: 'no-reply@nyatimotionpictures.com',
            subject: 'Nyatiflix Password Reset Successful.',
            html: renderConfirmPassChange({
                email: record.user.email,
                firstname: record.user.firstname,
            }),
        });

        // Delete the token
        await prisma.passwordResetToken.delete({ where: { id: record.id } });

        res.status(200).json({ message: 'Password reset successfully' });
    } catch (error) {
        if (!error.statusCode) error.statusCode = 500;
        next(error);
    }
};
