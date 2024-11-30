import { env } from '@/env.mjs';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';

const isProduction = true;

export const PESA_URL = isProduction ? env.PESA_LIVE_URL : env.PESA_SANDBOX_URL;
export const CONSUMER_KEY = isProduction
    ? env.LIVE_PESA_KEY
    : env.SANDBOX_PESA_KEY;
export const CONSUMER_SECRET = isProduction
    ? env.LIVE_PESA_SECRET
    : env.SANDBOX_PESA_SECRET;

//getIPN - FUNCTION
export const getIPN = async (token, checkorigin) => {
    try {

        let callbackUrl = checkorigin === "web" ? `https://api.nyatimotionpictures.com/api/v1/payment/pesapal/tansact_statuses` : "https://api.nyatimotionpictures.com/api/v1/film/pesapal/checkpaymentstatus";
        let headers = {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Authorization: token,
        };

        const PesaRequestLink = `${PESA_URL}/api/URLSetup/GetIpnList`;

        let getRegistration = await axios.get(PesaRequestLink, {
            headers: headers,
        });
        let getRegister_Payload;
        //console.log("first here d", getRegistration.data)
        if (getRegistration.data.length > 0) {
            console.log('here d');

            let registerDetail = getRegistration.data.filter((data, index) =>
                data.url.includes(callbackUrl)
            );

            console.log('included', registerDetail);
            if (registerDetail.length > 0) {
                return (getRegister_Payload = {
                    n_id: registerDetail[0].ipn_id,
                    type: 'success',
                });
            } else {
                return (getRegister_Payload = {
                    n_id: null,
                    type: 'not found',
                    code: 404,
                });
            }
        } else {
            return (getRegister_Payload = {
                n_id: null,
                type: 'not found',
                code: 404,
            });
        }
    } catch (error) {
        if (!error.statusCode) {
            error.statusCode = 500;
        }
        let getRegister_Payload;
        return (getRegister_Payload = {
            n_id: null,
            type: 'error',
            error: error,
        });
        // next(error)
    }
};

/** Does the IPN Send only once */
export const registerIPN = async (token, checkorigin) => {
    try {

        let callbackUrl = checkorigin === "web" ? `https://api.nyatimotionpictures.com/api/v1/payment/pesapal/tansact_statuses` : "https://api.nyatimotionpictures.com/api/v1/film/pesapal/checkpaymentstatus";
        let requestParameters = {
            url: callbackUrl,
            ipn_notification_type: 'GET',
        };
        let headers = {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Authorization: token,
        };

        const PesaRequestLink = `${PESA_URL}/api/URLSetup/RegisterIPN`;

        let registration = await axios.post(
            PesaRequestLink,
            requestParameters,
            { headers: headers }
        );

        return {
            n_id: registration.data.ipn_id,
            type: success,
        };

        // next();
    } catch (error) {
        if (!error.statusCode) {
            error.statusCode = 500;
        }
        let getRegister_Payload;
        return (getRegister_Payload = {
            n_id: null,
            type: 'error',
            error: error,
        });
    }
};

export const pesapalPaymentRequest = async ({
    token,
    firstName,
    lastName,
    description,
    amount,
    ipnID,
    callbackURL,
}) => {
    try {
        const createdUUID = uuidv4();
        const headers = {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Authorization: token,
        };

        const requestParameters = {
            id: createdUUID,
            paym: 'Visa',
            amount,
            currency: 'UGX',
            description,
            callback_url: callbackURL,
            cancellation_url: '', //optional
            notification_id: ipnID,
            branch: '',
            billing_address: {
                phone_number: phoneNumber,
                email_address: email,
                country_code: '', //optional
                first_name: firstName, //optional
                middle_name: '',
                last_name: lastName,
                line_1: '',
                line_2: '',
                city: '',
                state: '',
                postal_code: '',
                zip_code: '',
            },
        };

        const pesaRequestLink = `${PESA_URL}/api/Transactions/SubmitOrderRequest`;

        const response = await axios.post(pesaRequestLink, requestParameters, {
            headers,
        });

        console.log('submitOrder', response.data);
        return { data: response.data };
    } catch (error) {
        throw error;
    }
};

export const pesaCheckStatus = async ({ orderTrackingId, token }) => {
    try {
        const pesaRequestLink = `${PESA_URL}/api/Transactions/GetTransactionStatus?orderTrackingId=${orderTrackingId}`;

        const headers = {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Authorization: token,
        };

        const response = await axios.get(pesaRequestLink, { headers });

        console.log('submitOrder', response.data);
        return { data: response.data };
    } catch (error) {
        throw error;
    }
};
