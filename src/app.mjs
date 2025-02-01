import * as express from 'express';

import api from './api/index.mjs';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { CORS_OPTIONS } from './utils/corsOptions.js';
// import { specs, swaggerUICss } from './services/swagger.js';
// import swaggerUi from 'swagger-ui-express';

const htmlTemplate = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Nyati Studio Server Status</title>
    <style>
        body {
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            background-color: #141118; /* Dark background */
            font-family: Arial, sans-serif;
        }
        .status {
            text-align: center;
            padding: 20px;
            border: 1px solid #ccc;
            border-radius: 5px;
            background-color: #1A171E; /* Background color for the status box */
            box-shadow: 0 2px 10px rgba(0, 0, 0, 0.04);
        }
        h1 {
            color: #F2F2F2; /* Updated primary color */
        }
        p {
            color: #FFFAF6; /* Secondary white */
        }
        a {
            color: #F2F2F2; /* Updated primary color for links */
            text-decoration: none;
        }
        a:hover {
            text-decoration: underline; /* Underline on hover */
        }
        img {
            max-width: 150px; /* Set a maximum width for the logo */
            margin-bottom: 15px; /* Add some space below the logo */
        }
    </style>
</head>
<body>
    <div class="status">
        <img src="https://ik.imagekit.io/nyatimot/Pages/Universal+Home/Logos/Logo1.svg?updatedAt=1724072184503" alt="Nyati Motion Pictures Logo">
        <h1>Studio API Server is Live</h1> <!-- Updated Message -->
        <p>The Nyati Motion Pictures Studio API server is up and running.</p>
        <p>For any inquiries, contact us at <a href="mailto:info@nyatimotionpictures.com">info@nyatimotionpictures.com</a></p>
    </div>
</body>
</html>`;

/**
 * @module app
 * @name customizeApp
 * @description Customize the Express app instance
 * @param {express.Application} app - The Express app instance
 * @returns {void}
 */
export default function customizeApp(app) {
    // trust proxy
    app.set('trust proxy', 1);

    app.use(express.json());
    app.use(express.urlencoded({ extended: false }));

    app.use(cors(CORS_OPTIONS));

    // Rate limiter
    const limiter = rateLimit({
        windowMs: 15 * 60 * 1000, // 15 minutes
        max: 100, // limit each IP to 100 requests per windowMs
        // skip video upload route
        skip: (req) => {
            console.log(req.url, req.originalUrl);
            const urlsToSkip = [
                '/api/v1/studio/upload-chunk',
                '/api/v1/studio/check-upload-chunk',
            ];
            return urlsToSkip.includes(req.url);
        },
    });
    // app.use(limiter);

    // Cookie parser
    app.use(cookieParser());

    // Compression
    app.use(compression());

    // Setup static files
    // app.use(express.static(path.join(__dirname, 'public')));

    // // Swagger Docs
    // app.use(
    //     '/docs',
    //     swaggerUi.serve,
    //     swaggerUi.setup(specs, {
    //         customCss:
    //             '.swagger-ui .opblock .opblock-summary-path-description-wrapper { align-items: center; display: flex; flex-wrap: wrap; gap: 0 10px; padding: 0 10px; width: 100%; }',
    //         customCssUrl: swaggerUICss,
    //     })
    // );

    // Test correct number of proxies between the user and the server
    app.get('/ip', (req, res) => {
        res.send(req.ip);
    });

    // API routes
    app.get('/', (_, res) => {
        res.status(200).send(htmlTemplate);
    });

    app.use('/api', api);

    // Error handling - 4xx except 404
    app.use((err, _, res, next) => {
        console.log('one four', err);
        if (err.statusCode >= 400 && err.statusCode < 500) {
            let message = err.message;
            if (!message && err.statusCode === 404) {
                message = 'The requested resource was not found';
            }

            res.status(err.statusCode).send({ message });
        } else {
            next(err);
        }
    });

    //Error handling - 5xx
    app.use((err, _, res, next) => {
        if (!err.statusCode) {
            err.statusCode = 500;
        }
        console.log('error', err?.message);
        res.status(500).send({
            message: err?.message ?? 'Internal server error',
        });
    });
}
