export const requestLogger = async (req, res, next) => {
    try {
        const requestUrl = req.originalUrl ?? req.url;
        const requestMethod = req.method;
        //   const isProduction = process.env.NODE_ENV === 'production';

        console.log(
            `Request URL: ${requestUrl} Request Method: ${requestMethod} Request Time: ${new Date().toISOString()}`
        );

        next();
    } catch (error) {
        if (!error.statusCode) {
            error.statusCode = 500;
        }
        next(error);
    }
};
