import express from 'express';
import {
   addEpisode,
   addFilm,
   createFilm,
   getFilmBySearch,
   getFilmByTag,
   getFilmWeb,
   getSingleFilm,
   updateFilm,
   uploadFilm,
   watchFilm2,
   watchFilmLink2,
   watchFilms,
   watchtrailerFilms,
} from '../controllers/filmControllers.js';
import { verifyToken } from '../middleware/verifyToken.js';
import { filmSchema, filmSchemaUpdate } from '../validationschemas/index.js';
import multer from 'multer';
import { validateData } from '../middleware/validateBody.mjs';

const router = express.Router();

const upload = multer({
   storage: multer.memoryStorage(),
});

router.post('/create', verifyToken, validateData(filmSchema), createFilm);
router.put(
   '/update/:filmId',
   verifyToken,
   validateData(filmSchemaUpdate),
   updateFilm
);
router.post(
   '/upload/:filmId',
   verifyToken,
   // validateData(filmSchemaUpdate),
   upload.single('film'),
   uploadFilm
);
// router.put('/:id', verifyToken, updateFilm);
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
