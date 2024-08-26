/**
 * @name returnError
 * @description Return Error
 * @param {string} message
 * @param {Number} statusCode
 * @returns {void}
 */
export const returnError = (message, statusCode) => {
   const error = new Error(message);
   error.statusCode = statusCode;
   throw error;
};
