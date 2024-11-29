import axios from 'axios';
import {
    getAPIKey,
    TARGET_ENV,
    MOMO_BASE_URL,
    createAPIUser,
    SUBSCRIPTION_KEY,
} from '@/services/mtnpayments.js';
import { env } from '@/env.mjs';

export const generateMTNAuthTk = async (req, res, next) => {
    try {
        const isProd = true;
        const API_USER = isProd
            ? env.MOMO_PROD_API_USER
            : await createAPIUser(SUBSCRIPTION_KEY);

        const API_KEY = isProd
            ? env.MOMO_PROD_API_KEY
            : await getAPIKey(SUBSCRIPTION_KEY, API_USER);

        const combinedKeys = Buffer.from(`${API_USER}:${API_KEY}`).toString(
            'base64'
        );

        const BasicAuth = `Basic ${combinedKeys}`;
        const TokenReqLink = `${MOMO_BASE_URL}/collection/token/`;
        const generatedTk = await axios.post(TokenReqLink, undefined, {
            headers: {
                Authorization: BasicAuth,
                'X-Target-Environment': TARGET_ENV,
                'Content-Type': 'application/json',
                'Ocp-Apim-Subscription-Key': SUBSCRIPTION_KEY,
            },
        });

        if (!generatedTk.data.access_token) {
            throw new Error('Could not generate access token');
        }

        // console.log('momo_access_token', generatedTk.data.access_token);
        req.mtn_access_token = `Bearer ${generatedTk.data.access_token}`;
        next();
    } catch (error) {
        console.log('errorZ::', error);
        if (!error.statusCode) {
            error.statusCode = 500;
        }
        next(error);
    }
};
