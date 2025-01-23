import express from 'express';
import {
    getFilmBySearch,
    streamFilm,
    fetchFilms,
    fetchFilm,
    fetchSimilarFilms,
    getVideoSource,
    addWatchList,
    getWatchList,
    removeFromWatchlist,
    likeRateFilm,
    purchaseFilm,
    checkPaymentStatus,
    donateToFilm,
    checkPesapalPaymentStatus,
    fetchSeason,
    fetchEpisode,
} from '../controllers/filmControllers.js';
import { verifyToken } from '../middleware/verifyToken.js';
import { generateMTNAuthTk } from '../middleware/generateMTNAuthTK.js';
import { generateIPN_ID, generatePesaAuthTk } from '../middleware/pesapalmw.js';

const router = express.Router();

router.post('/watchlist/:filmId/:userId', verifyToken, addWatchList);
router.post(
    '/purchase/:userId/:videoId',
    // verifyToken,
    generatePesaAuthTk,
    generateIPN_ID,
    generateMTNAuthTk,
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

// GET
router.get('/stream/:trackId', streamFilm);
router.get('/all', fetchFilms);
router.get('/:filmId', verifyToken, fetchFilm);
router.get('/similar/:filmId', verifyToken, fetchSimilarFilms);
router.get('/track/:trackid', getVideoSource);
router.get('/watchlist/:userId', getWatchList);
router.get('/search', getFilmBySearch);
router.get(
    '/checkpaymentstatus/:orderId',
    // verifyToken,
    generateMTNAuthTk,
    checkPaymentStatus
);
router.get('/season/:seasonId', verifyToken, fetchSeason);
router.get('/episode/:episodeId', verifyToken, fetchEpisode);

router.get(
    '/pesapal/checkpaymentstatus',
    // verifyToken,
    generatePesaAuthTk,
    checkPesapalPaymentStatus
);

// PUT
router.put('/likerate/:filmId/:userId', verifyToken, likeRateFilm);

// DELETE
router.delete('/watchlist/:id/:userId', verifyToken, removeFromWatchlist);

export default router;
