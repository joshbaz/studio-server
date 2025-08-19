import express from 'express';
import { getUsers } from '../controllers/userControllers.js';
import { verifyToken } from '../middleware/verifyToken.js';
import {
    getDonations,
    getFilms,
    getFilm,
    createFilm,
    updateFilm,
    deleteFilm,
    createSeason,
    createEpisode,
    updateSeason,
    updateEpisode,
    deleteSeason,
    deleteEpisode,
    uploadPoster,
    uploadEpisodePoster,
    getPurchaseHistory,
    deletePoster,
    uploadTrailer,
    deleteVideo,
    getCategories,
    getCategory,
    deleteCategory,
    createCategory,
    removeFilmFromCategory,
    addFilmToCategory,
    updateCategory,
    checkUploadChunk,
    uploadChunk,
    createPricing,
    updatePricing,
    deleteVideos,
    checkingChunks,
    
    combiningChunks,
    // uploadingTrailer,
    uploadFilm2,
    // Video Processing Job Management
    getVideoProcessingJobs,
    getVideoProcessingJob,
    cancelVideoProcessingJob,
    deleteVideoProcessingJob,
    retryVideoProcessingJob,
    clearCompletedJobs,
    cleanupFailedJob,
    checkExistingProcessingJob,
    syncJobStatus,
    fixStuckJobs,
    // Upload Job Management
    getUploadJobs,
    retryUploadJob,
    cancelUploadJob,
    deleteUploadJob,
    clearUploadJobs,
    cleanupFailedUploadJob,
    syncUploadJobStatus,
    fixStuckUploadJobs,
    // Subtitle Management
    uploadSubtitle,
    deleteSubtitle,
    updateSubtitle,
} from '../controllers/studio.js';
import { validateData } from '../middleware/validateBody.mjs';
import {
    episodeSchema,
    filmSchema,
    seasonSchema,
    categorySchema,
    updateFilmSchema,
    removeFilmFromCategorySchema,
    addCategorySchema,
    updateCategorySchema,
    pricingSchema,
    updatePricingSchema,
    seasonUpdateSchema,
    deleteVideoSchema,
} from '../validationschemas/index.js';
import { upload } from '@/services/multer.js';
import multer from 'multer';

const checkPoster = multer({
    storage: multer.memoryStorage(),
    fileFilter: (_, file, cb) => {
        const supportedTypes = ['image/jpeg', 'image/png'];
        if (supportedTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(null, false);
        }
    },
});
const router = express.Router();

// Custom multer configuration for subtitle files
const subtitleUpload = multer({
    storage: multer.memoryStorage(), // Use memory storage for testing
    fileFilter: (req, file, cb) => {
        console.log('📝 Multer fileFilter called with file:', file);
        console.log('📝 File fieldname:', file.fieldname);
        console.log('📝 File originalname:', file.originalname);
        console.log('📝 File mimetype:', file.mimetype);
        
        if (file.mimetype === 'text/vtt' || file.originalname.endsWith('.vtt')) {
            console.log('📝 File accepted by multer');
            cb(null, true);
        } else {
            console.log('📝 File rejected by multer:', file.mimetype, file.originalname);
            cb(new Error('Only .vtt subtitle files are allowed'), false);
        }
    },
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB limit
    }
});

// Test route to check if multer is working
router.post('/test-upload', verifyToken, subtitleUpload.single('subtitleFile'), (req, res) => {
    console.log('📝 Test upload route called');
    console.log('📝 Request body:', req.body);
    console.log('📝 Request file:', req.file);
    res.json({ 
        success: true, 
        message: 'Test upload successful',
        body: req.body,
        file: req.file ? {
            fieldname: req.file.fieldname,
            originalname: req.file.originalname,
            mimetype: req.file.mimetype,
            size: req.file.size
        } : null
    });
});



// GET Routes
router.get('/films', getFilms);
router.get('/films/:filmId', getFilm);
router.get('/users', getUsers);
router.get('/donations', verifyToken, getDonations);
router.get('/purchasehistory', verifyToken, getPurchaseHistory);
router.get('/categories', verifyToken, getCategories);
router.get('/category/:categoryId', verifyToken, getCategory);
router.get('/check-upload-chunk', verifyToken, checkUploadChunk);

// JOSHUA'S ROUTES for video testing
router.get('/check-upload-chunks', verifyToken, checkingChunks);

router.post('/combine-chunks', verifyToken, combiningChunks);
// router.post('/trailer-uploads', verifyToken, uploadingTrailer);

// POST Routes
router.post('/newfilm', verifyToken, validateData(filmSchema), createFilm);
router.post('/upload-chunk', verifyToken, upload.single('chunk'), uploadChunk);
router.post('/complete-upload', verifyToken, uploadFilm2);
router.post('/trailer-upload', verifyToken, uploadTrailer); // requires resourseId { filmId or seasonId }, clientID (for socket.io), and fileName
router.post(
    '/posterupload/:resourceId',
    verifyToken,
    checkPoster.single('poster'),
    uploadPoster
);
router.post(
    '/newseason/:filmId',
    verifyToken,
    validateData(seasonSchema),
    createSeason
);
router.post(
    '/newepisode/:seasonId',
    verifyToken,
    validateData(episodeSchema),
    createEpisode
);
router.post(
    '/uploadposter/:episodeId',
    verifyToken,
    checkPoster.single('poster'),
    uploadEpisodePoster
);

router.post(
    '/newcategory',
    verifyToken,
    validateData(categorySchema),
    createCategory
);
router.post(
    '/pricing',
    verifyToken,
    validateData(pricingSchema),
    createPricing
);

// PUT Routes
router.put(
    '/films/:filmId',
    verifyToken,
    validateData(updateFilmSchema),
    updateFilm
);
router.put(
    '/season/:seasonId',
    verifyToken,
    validateData(seasonUpdateSchema),
    updateSeason
);
router.put(
    '/episode/:episodeId',
    verifyToken,
    validateData(episodeSchema),
    updateEpisode
);
router.put(
    '/category/update/:categoryId',
    verifyToken,
    validateData(updateCategorySchema),
    updateCategory
);
router.put(
    '/category/addfilm/:categoryId',
    verifyToken,
    validateData(addCategorySchema),
    addFilmToCategory
);
router.put(
    '/category/remove/:categoryId',
    verifyToken,
    validateData(removeFilmFromCategorySchema),
    removeFilmFromCategory
);
router.put(
    '/pricing/:id',
    verifyToken,
    validateData(updatePricingSchema),
    updatePricing
);

// DELETE Routes
router.delete('/films/:filmId', verifyToken, deleteFilm);
router.delete('/season/:seasonId', verifyToken, deleteSeason);
router.delete('/episode/:episodeId', verifyToken, deleteEpisode);
router.delete('/video/:videoId', verifyToken, deleteVideo);
router.delete('/poster/:posterId', verifyToken, deletePoster);
router.delete('/category/:categoryId', verifyToken, deleteCategory);
router.delete(
    '/videos',
    verifyToken,
    validateData(deleteVideoSchema),
    deleteVideos
);

// Video Processing Job Management Routes
router.get('/processing-jobs', verifyToken, getVideoProcessingJobs);
router.get('/processing-jobs/check-existing', verifyToken, checkExistingProcessingJob);
router.get('/processing-jobs/:jobId', verifyToken, getVideoProcessingJob);
router.post('/processing-jobs/:jobId/cancel', verifyToken, cancelVideoProcessingJob);
router.post('/processing-jobs/:jobId/retry', verifyToken, retryVideoProcessingJob);
router.post('/processing-jobs/:jobId/cleanup', verifyToken, cleanupFailedJob);
router.post('/processing-jobs/:jobId/sync', verifyToken, syncJobStatus);
router.post('/processing-jobs/fix-stuck', verifyToken, fixStuckJobs);
router.delete('/processing-jobs/:jobId', verifyToken, deleteVideoProcessingJob);
router.post('/processing-jobs/clear', verifyToken, clearCompletedJobs);

// Upload Job Management Routes
router.get('/upload-jobs', verifyToken, getUploadJobs);
router.post('/upload-jobs/:jobId/retry', verifyToken, retryUploadJob);
router.post('/upload-jobs/:jobId/cancel', verifyToken, cancelUploadJob);
router.delete('/upload-jobs/:jobId', verifyToken, deleteUploadJob);
router.post('/upload-jobs/clear', verifyToken, clearUploadJobs);
router.post('/upload-jobs/:jobId/cleanup', verifyToken, cleanupFailedUploadJob);
router.post('/upload-jobs/:jobId/sync', verifyToken, syncUploadJobStatus);
router.post('/upload-jobs/fix-stuck', verifyToken, fixStuckUploadJobs);

// Subtitle Management Routes
router.post('/upload-subtitle', verifyToken, subtitleUpload.single('subtitleFile'), (err, req, res, next) => {
    console.log('📝 Multer error handler called');
    console.log('📝 Error:', err);
    console.log('📝 Request body:', req.body);
    console.log('📝 Request file:', req.file);
    console.log('📝 Request headers:', req.headers);
    console.log('📝 Content-Type:', req.headers['content-type']);
    
    if (err instanceof multer.MulterError) {
        console.log('📝 Multer error type:', err.code);
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({
                success: false,
                message: 'File size too large. Maximum size is 5MB.'
            });
        }
        return res.status(400).json({
            success: false,
            message: 'File upload error: ' + err.message
        });
    } else if (err) {
        console.log('📝 Other error:', err.message);
        return res.status(400).json({
            success: false,
            message: err.message
        });
    }
    console.log('📝 No errors, proceeding to uploadSubtitle');
    next();
}, uploadSubtitle);
router.delete('/delete-subtitle/:subtitleId', verifyToken, deleteSubtitle);
router.put('/update-subtitle/:subtitleId', verifyToken, updateSubtitle);

export default router;
