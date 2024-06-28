import express from 'express';
import {
   addEpisode,
   addFilm,
   getFilmBySearch,
   getFilmByTag,
   getFilmWeb,
   getSingleFilm,
   updateFilm,
   watchFilm2,
   watchFilmLink2,
   watchFilms,
   watchtrailerFilms,
} from '../controllers/filmControllers.js';
import { verifyToken } from '../v1/4-middleware/verifyToken.js';
import multer from 'multer';
const router = express.Router();
import dotenv from 'dotenv';
dotenv.config();

const upload = multer({
   storage: multer.memoryStorage(),
});

router.post('/create', upload.single('film'), addFilm);
router.put('/:id', verifyToken, updateFilm);
router.put('/add/episode/:id', addEpisode);
router.get('/web/:keys/:t', watchFilmLink2);
router.get('/:keys', watchFilm2);
router.get('/', getFilmWeb);
router.get('/sfilm/:id', getSingleFilm);
router.post('/:id', verifyToken, watchFilms);
router.get('/tags', getFilmByTag);
router.get('/search', getFilmBySearch);

router.post('/trailer/:id', verifyToken, watchtrailerFilms);

export default router;
