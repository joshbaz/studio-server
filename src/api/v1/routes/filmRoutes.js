import express from 'express';
import {
    streamFilm,
    fetchFilms,
    fetchFilm,
    fetchSimilarFilms,
    getVideoSource,
    getWatchList,
    likeRateFilm,
    purchaseFilm,
    checkPaymentStatus,
    donateToFilm,
    checkPesapalPaymentStatus,
    fetchSeason,
    fetchEpisode,
    fetchSeasons,
    fetchFeaturedFilms,
    lookupFilms,
    manageWatchlist,
} from '../controllers/filmControllers.js';
import { verifyToken } from '../middleware/verifyToken.js';
import { generateMTNAuthTk } from '../middleware/generateMTNAuthTK.js';
import { generateIPN_ID, generatePesaAuthTk } from '../middleware/pesapalmw.js';
import { validateData } from '../middleware/validateBody.mjs';
import {
    likeSchema,
    purchaseSchema,
    watchlistSchema,
} from '../validationschemas/index.js';

const router = express.Router();

router.post(
    '/watchlist/add',
    verifyToken,
    validateData(watchlistSchema),
    manageWatchlist
);
router.post(
    '/purchase',
    // verifyToken,
    generatePesaAuthTk,
    generateIPN_ID,
    generateMTNAuthTk,
    validateData(purchaseSchema),
    purchaseFilm
);
router.post(
    '/donate/:userId/:filmId',
    // verifyToken,
    generatePesaAuthTk,
    generateIPN_ID,
    generateMTNAuthTk,
    donateToFilm
);
router.post('/likerate', verifyToken, validateData(likeSchema), likeRateFilm);

// GET
router.get('/all', fetchFilms);
router.get('/stream/:trackId', streamFilm);
router.get('/featured', verifyToken, fetchFeaturedFilms);
router.get('/:filmId', verifyToken, fetchFilm);
router.get('/similar/:filmId', fetchSimilarFilms);
router.get('/track/:trackid', getVideoSource);
router.get('/watchlist/:userId', getWatchList);
router.get('/lookup/:q', verifyToken, lookupFilms);
router.get(
    '/checkpaymentstatus/:orderId',
    // verifyToken,
    generateMTNAuthTk,
    checkPaymentStatus
);
router.get('/season/all', verifyToken, fetchSeasons);
router.get('/season/:seasonId', verifyToken, fetchSeason);
router.get('/episode/:episodeId', verifyToken, fetchEpisode);

router.get(
    '/pesapal/checkpaymentstatus',
    // verifyToken,
    generatePesaAuthTk,
    checkPesapalPaymentStatus
);

export default router;
