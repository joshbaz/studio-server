import axios from 'axios';
import { v5 as uuidv5, v4 as uuidv4 } from 'uuid';

import { env } from '@/env.mjs';

// is production
const isProduction = env.NODE_ENV === 'production';

/**
 * @name generateUUID
 * @description generates a unique UUID
 * @param {string} primaryKey
 * @param {string} secondaryKey
 * @returns string
 */
export const generateUUID = (primaryKey, secondaryKey) => {
    const combinedKeys = `${primaryKey}-${secondaryKey}213561`;
    const createdUUID = uuidv5(combinedKeys, uuidv5.URL);
    return createdUUID;
};

/**
 * @name createAPIUser
 * @description creates an API user
 * @param {string} subscriptionKey
 */
export const createAPIUser = async (subcriptionKey) => {
    const primaryKey = env.MOMO_COLLECT_PRIMARY;
    const secondaryKey = env.MOMO_COLLECT_SECONDARY;
    const uniqueUUID = generateUUID(primaryKey, secondaryKey);

    // // register the API user - Needs to only run once
    // const requestURL = `${env.MOMO_SANDBOX_URL}/v1_0/apiuser`;
    // const headers = {
    //     'X-Reference-Id': uniqueUUID,
    //     'Content-Type': 'application/json',
    //     'Ocp-Apim-Subscription-Key': subcriptionKey,
    // };

    // const req = await axios.post(
    //     requestURL,
    //     {
    //         providerCallbackHost: 'localhost:4500', // just for sandbox usage
    //     },
    //     { headers }
    // );

    // console.log('API User created', req.data);

    return uniqueUUID;
};

/**
 * @name getAPIKey
 * @description retrieves the API key
 * @param {string} subscriptionKey
 */
export const getAPIKey = async (subscriptionKey, apiUser) => {
    try {
        const KEY_URL = `${env.MOMO_SANDBOX_URL}/v1_0/apiuser/${apiUser}/apikey`;
        const response = await axios.post(KEY_URL, undefined, {
            headers: {
                'Content-Type': 'application/json',
                'Ocp-Apim-Subscription-Key': subscriptionKey,
            },
        });

        return response.data.apiKey ?? '';
    } catch (error) {
        throw error.message;
    }
};

export const SUBSCRIPTION_KEY = isProduction
    ? env.MOMO_COLLECT_PROD_PRIMARY
    : env.MOMO_COLLECT_PRIMARY;

export const MOMO_BASE_URL = isProduction
    ? env.MOMO_PROD_BASE_URL
    : env.MOMO_SANDBOX_URL;

export const TARGET_ENV = isProduction
    ? env.MOMO_TARGET_ENV_PROD
    : env.MOMO_TARGET_ENV_SANDBOX;

/**
 * @typedef {Object} mtnParams
 * @property {string} token
 * @property {string} amount
 * @property {string} currency
 * @property {string} [callbackURL]
 * @property {string} phoneNumber
 * @property {string} [paymentMessage]
 * @property {string} [payeeNote]
 */

/**
 * @name mtnPaymentRequest
 * @description initiates a payment request to MTN
 * @param {mtnParams} params
 * @returns {Promise<{status: string, orderTrackingId: string}>}
 */
export const mtnPaymentRequest = async ({
    token,
    amount,
    currency,
    phoneNumber,
    callbackURL,
    paymentMessage,
    payeeNote,
}) => {
    try {
        const externalId = uuidv4();
        const requestURL = `${MOMO_BASE_URL}/collection/v1_0/requesttopay`;

        const requestParams = {
            amount,
            currency,
            externalId,
            payer: {
                partyIdType: 'MSISDN',
                partyId: phoneNumber,
            },
            payerMessage: paymentMessage ?? 'Payment for service',
            payeeNote: payeeNote ?? 'Payee note',
        };

        const headers = {
            'Content-Type': 'application/json',
            Authorization: token,
            'X-Reference-Id': externalId,
            'X-Target-Environment': TARGET_ENV,
            'Ocp-Apim-Subscription-Key': SUBSCRIPTION_KEY,
        };

        if (callbackURL) {
            headers['X-Callback-Url'] = `${callbackURL}/${externalId}`;
        }

        const res = await axios.post(requestURL, requestParams, { headers });
        return { status: res.statusText, orderTrackingId: externalId };
    } catch (error) {
        throw new Error(error.message ?? 'Could not initiate payment');
    }
};

const selectMessage = (shortMessage) => {
    switch (shortMessage) {
        case 'failed':
            return 'Transaction has Failed';
        case 'successful':
            return 'Transaction Successful';
        case 'pending':
            return 'Transaction Pending';
        case 'rejected':
            return 'Transaction Rejected';
        case 'timeout':
            return 'Transaction Timedout';
        default:
            return null;
    }
};
/**
 * @name checkPaymentStatus
 * @description checks the status of a payment
 * @param {{
 *  token: string,
 *  trackingId: string
 * }} params
 * @returns {Promise<any>}
 */
export const checkPaymentStatus = async ({ token, trackingId }) => {
    try {
        if (!trackingId || !token) {
            throw new Error('Tracking ID and token are required');
        }
        const requestURL = `${MOMO_BASE_URL}/collection/v1_0/requesttopay/${trackingId}`;

        const headers = {
            'Content-Type': 'application/json',
            Authorization: token,
            'X-Target-Environment': TARGET_ENV,
            'Ocp-Apim-Subscription-Key': SUBSCRIPTION_KEY,
        };

        const response = await axios.get(requestURL, { headers });

        if (!response.data.status) {
            throw new Error('Could not check payment status');
        }

        const transactStatus = selectMessage(
            response.data.status.toLowerCase()
        );

        console.log('response', response.data);

        return { status: transactStatus, data: response.data };
    } catch (error) {
        throw new Error(error.message ?? 'Could not check payment status');
    }
};
