import express from 'express';
import {
    previewFilm,
    previewSeason,
    previewEpisode,
} from '../controllers/ogPreview.js';

const router = express.Router();

/**
 * Social preview shell routes.
 *
 * These mirror the public urls the consumer app serves
 * (/film/:slug, /series/:slug, /segments/:slug, /episode/:slug/:series/:season)
 * with a /preview prefix, so the static host can proxy just these paths here
 * while it keeps serving the hashed assets itself. Deliberately unauthenticated
 * and unrated: a crawler has no session, and a 401 would produce a blank card.
 */

router.get('/film/:slug', previewFilm);
router.get('/series/:slug', previewFilm);
router.get('/segments/:slug', previewSeason);
router.get('/episode/:slug/:seriesSlug/:seasonSlug', previewEpisode);

export default router;
