import multer from 'multer';

export const upload = multer({
    storage: multer.memoryStorage(),
    fileFilter: (_, file, cb) => {
        console.log(file);
        const supportedTypes = [
            'video/mp4',
            'video/MOV',
            'video/x-m4v',
            'video/avi',
            'video/mpeg',
            'image/jpeg',
            'image/png',
        ];
        if (supportedTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('File format not supported'), false);
        }
    },
});
