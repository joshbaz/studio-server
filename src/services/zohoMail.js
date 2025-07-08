import axios from 'axios';

const ZOHO_CLIENT_ID = process.env.ZOHO_CLIENT_ID;
const ZOHO_CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET;
const ZOHO_REFRESH_TOKEN = process.env.ZOHO_REFRESH_TOKEN;
const ZOHO_ACCOUNT_ID = process.env.ZOHO_ACCOUNT_ID;
const ZOHO_FROM_ADDRESS = process.env.ZOHO_FROM_ADDRESS;

/**
 * Get a fresh Zoho OAuth2 access token using the refresh token
 */
export const getZohoAccessToken = async () => {
  try {
    const res = await axios.post('https://accounts.zoho.com/oauth/v2/token', null, {
      params: {
        refresh_token: ZOHO_REFRESH_TOKEN,
        client_id: ZOHO_CLIENT_ID,
        client_secret: ZOHO_CLIENT_SECRET,
        grant_type: 'refresh_token',
      },
    });
    return res.data.access_token;
  } catch (error) {
    console.error('Failed to refresh Zoho access token:', error?.response?.data || error.message);
    throw new Error('Failed to refresh Zoho access token');
  }
};

/**
 * Send an email using Zoho Mail API (always uses a fresh access token)
 * @param {Object} options
 * @param {string} options.to - Recipient email address
 * @param {string} options.subject - Email subject
 * @param {string} options.html - Email HTML content
 * @param {string} [options.from] - Sender email address (optional)
 */
export const sendZohoMail = async ({ to, subject, html, from }) => {
  try {
    const accessToken = await getZohoAccessToken();
   
   
    const response = await axios.post(
      `https://mail.zoho.com/api/accounts/${ZOHO_ACCOUNT_ID}/messages`,
      {
        fromAddress:  from || ZOHO_FROM_ADDRESS,
        toAddress: to,
        subject,
        content: html,
        mailFormat: 'html',
      },
      {
        headers: {
          Authorization: `Zoho-oauthtoken ${accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    );
    return response.data;
  } catch (error) {
    console.error('Zoho Mail API error:', error?.response?.data || error.message);
    throw new Error('Failed to send email via Zoho Mail API');
  }
}; 