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
    uploadFilm,
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
    uploadingChunks,
    combiningChunks,
    uploadingFilm,
    uploadingTrailer,
    uploadFilm2,
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
router.post(
    '/upload-chunks',
    verifyToken,
    upload.single('chunk'),
    uploadingChunks
);
router.post('/combine-chunks', verifyToken, combiningChunks);
router.post('/complete-uploads', verifyToken, uploadingFilm);
router.post('/trailer-uploads', verifyToken, uploadingTrailer);

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

export default router;
