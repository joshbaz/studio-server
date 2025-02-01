import multer from 'multer';
import path from 'path';
import fs from 'fs';

export const UPLOAD_DIR = path.resolve(process.cwd(), 'uploads');

if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR);
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, UPLOAD_DIR);
    },
    filename: (req, file, cb) => {
        cb(null, file.originalname); // add timestamp to the file name to avoid overwriting
    },
});

export const upload = multer({
    storage,
    fileFilter: (_, file, cb) => {
        const supportedTypes = [
            'video/*',
            'image/jpeg',
            'image/png',
            'application/octet-stream',
        ];

        if (supportedTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('File format not supported'), false);
        }
    },
});
