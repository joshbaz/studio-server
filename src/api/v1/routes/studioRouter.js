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
    uploadEpisode,
    uploadFilm,
    uploadEpisodePoster,
    updateVideoPrice,
    getPurchaseHistory,
    deletePoster,
    uploadTrailer,
    deleteVideo,
    getCategories,
    getCategory,
    updateCategory,
    deleteCategory,
    createCategory,
} from '../controllers/studio.js';
import { validateData } from '../middleware/validateBody.mjs';
import {
    episodeSchema,
    filmSchema,
    seasonSchema,
    categoryUpdateSchema,
    categoryFilmSchema,
} from '../validationschemas/index.js';
import { upload } from '@/services/multer.js';

const router = express.Router();

// GET Routes
router.get('/films', getFilms);
router.get('/films/:filmId', getFilm);
router.get('/users', getUsers);
router.get('/donations', verifyToken, getDonations);
router.get('/purchasehistory', verifyToken, getPurchaseHistory);
router.get('/categories', verifyToken, getCategories);
router.get('/category/:categoryId', verifyToken, getCategory);

// POST Routes
router.post('/newfilm', verifyToken, validateData(filmSchema), createFilm);
router.post(
    '/filmupload/:filmId',
    verifyToken,
    upload.single('film'),
    uploadFilm
);
router.post(
    '/episodeupload/:episodeId',
    verifyToken,
    upload.single('film'),
    uploadEpisode
);
router.post(
    '/posterupload/:filmId',
    verifyToken,
    upload.single('poster'),
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
    upload.single('poster'),
    uploadEpisodePoster
);
router.post(
    '/uploadtrailer/:id', // id can be filmId or episodeId
    verifyToken,
    upload.single('trailer'),
    uploadTrailer
);

router.post(
    '/newcategory',
    verifyToken,
    validateData(categoryFilmSchema),
    createCategory
);

// PUT Routes
router.put('/films/:filmId', verifyToken, validateData(filmSchema), updateFilm);
router.put(
    '/season/:seasonId',
    verifyToken,
    validateData(seasonSchema),
    updateSeason
);
router.put(
    '/episode/:episodeId',
    verifyToken,
    validateData(episodeSchema),
    updateEpisode
);
router.put('/updateVideoPrice/:videoId', verifyToken, updateVideoPrice);
router.put(
    '/category/:categoryId',
    verifyToken,
    validateData(categoryUpdateSchema),
    updateCategory
);

// DELETE Routes
router.delete('/films/:filmId', verifyToken, deleteFilm);
router.delete('/season/:seasonId', verifyToken, deleteSeason);
router.delete('/episode/:episodeId', verifyToken, deleteEpisode);
router.delete('/video/:videoId', verifyToken, deleteVideo);
router.delete('/poster/:posterId', verifyToken, deletePoster);
router.delete('/category/:categoryId', verifyToken, deleteCategory);

export default router;
