import swaggerJSDoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';

const options = {
    definition: {
        openapi: '3.1.0',
        info: {
            title: 'Nyati Motion Pictures API',
            version: '0.1.0',
            description:
                'Nyati (Buffalo) Motion Pictures (NMP) is a leading film and video production powerhouse in Uganda, East Africa, established in 2005.',
            license: {
                name: 'MIT',
                url: 'https://spdx.org/licenses/MIT.html',
            },
            contact: {
                name: 'Nyati Motion Pictures',
                url: 'https://nyatimotionpictures.com',
                email: 'info@nyatimotionpictures.com',
            },
        },
        servers: [
            { url: 'http://localhost:4500' },
            { url: 'https://api.nyatimotionpictures.com' },
        ],
    },
    apis: ['../api/**/*.js'],
};

export const specs = swaggerJSDoc(options);
export const swaggerUICss =
    'https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/4.3.0/swagger-ui.min.css';
