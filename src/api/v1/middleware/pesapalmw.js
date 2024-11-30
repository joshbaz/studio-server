import axios from 'axios';
import { env } from '@/env.mjs';
import {
    CONSUMER_KEY,
    CONSUMER_SECRET,
    getIPN,
    PESA_URL,
    registerIPN,
} from '@/services/pesapal.js';
//import payModel from '../models/payModel.js';

/** generateIPNID */
export const generateIPN_ID = async (req, res, next) => {
    try {
        
        let checkRequestOrigin = req.body.request_origin ?? "application";
        let Bearertk = `Bearer ${req.pesa_access_token}`;

        const checkIPN = await getIPN(Bearertk, checkRequestOrigin);

        if (checkIPN.type === 'success') {
            console.log('ipn exists');
            req.bearertk = Bearertk;
            req.ipn_id = checkIPN.n_id;
            next();
        } else if (checkIPN.type === 'not found') {
            console.log('no IPN REGISTERED');

            let register = await registerIPN(Bearertk, checkRequestOrigin);

            if (register.type === 'success') {
                req.bearertk = Bearertk;
                req.ipn_id = register.n_id;

                next();
            } else {
                next(register.error);
            }
        } else {
            next(checkIPN.error);
        }
    } catch (error) {
        if (!error.statusCode) {
            error.statusCode = 500;
        }
        next(error);
    }
};

//generate pesapal access token
export const generatePesaAuthTk = async (req, res, next) => {
    try {
        //console.log('Body', req.body);

        //test credentials
        let payload = {
            consumer_key: CONSUMER_KEY,
            consumer_secret: CONSUMER_SECRET,
        };

        // console.log("payload", payload, process.env.SECRETVA)

        //   console.log("process.env.Production_State", process.env.Production_State, process.env.PESA_LIVE_URL, process.env.PESA_Sandbox_URL)

        // console.log("SANDBOX_PESA_SECRET", process.env.SANDBOX_PESA_SECRET)

        let headers = {
            'Content-Type': 'application/json',
            Accept: '*/*',
        };

        const tkLink = `${PESA_URL}/api/Auth/RequestToken`;

        let generatedTk = await axios.post(tkLink, payload, {
            headers: headers,
        });

        //console.log("generatedTk", generatedTk)
        req.pesa_access_token = generatedTk.data.token;

        next();
    } catch (error) {
        if (!error.statusCode) {
            error.statusCode = 500;
        }
        next(error);
    }
};
