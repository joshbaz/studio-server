import express from 'express';
import { previewFilm, previewSeason } from '../controllers/ogPreview.js';

const router = express.Router();

/**
 * Social preview shell routes.
 *
 * These mirror the public urls the consumer app serves (/film/:slug,
 * /series/:slug, /segments/:slug) with a /preview prefix, so the static host can
 * proxy just these paths here while it keeps serving the hashed assets itself.
 * An episode shares the season route as /segments/:slug?ep=:episodeSlug, because
 * that is how the consumer app addresses it. Deliberately unauthenticated and
 * unrated: a crawler has no session, and a 401 would produce a blank card.
 */

router.get('/film/:slug', previewFilm);
router.get('/series/:slug', previewFilm);
router.get('/segments/:slug', previewSeason);

export default router;
