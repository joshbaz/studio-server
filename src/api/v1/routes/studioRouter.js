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
} from '../controllers/studio.js';
import { validateData } from '../middleware/validateBody.mjs';
import {
    episodeSchema,
    filmSchema,
    seasonSchema,
} from '../validationschemas/index.js';
import { upload } from '@/services/multer.js';

const router = express.Router();

// GET Routes
router.get('/films', getFilms);
router.get('/films/:filmId', getFilm);
router.get('/users', getUsers);
router.get('/donations', verifyToken, getDonations);
router.get('/purchasehistory', verifyToken, getPurchaseHistory);

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

// DELETE Routes
router.delete('/films/:filmId', verifyToken, deleteFilm);
router.delete('/season/:seasonId', verifyToken, deleteSeason);
router.delete('/episode/:episodeId', verifyToken, deleteEpisode);

export default router;
