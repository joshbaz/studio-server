import express from 'express';
import {
   addEpisode,
   addFilm,
   createFilm,
   getFilmBySearch,
   getFilmByTag,
   getFilmWeb,
   getSingleFilm,
   streamFilm,
   updateFilm,
   uploadFilm,
   watchFilm2,
   watchFilmLink2,
   watchFilms,
   fetchFilms,
   watchtrailerFilms,
   deleteFilm,
   uploadPoster,
   fetchFilm,
   uploadTrailer,
   streamTrailer,
   fetchSimilarFilms,
} from '../controllers/filmControllers.js';
import { verifyToken } from '../middleware/verifyToken.js';
import { filmSchema, filmSchemaUpdate } from '../validationschemas/index.js';
import multer from 'multer';
import { validateData } from '../middleware/validateBody.mjs';

const router = express.Router();

const upload = multer({
   storage: multer.memoryStorage(),
   fileFilter: (_, file, cb) => {
      const supportedTypes = [
         'video/mp4',
         'video/MOV',
         'video/avi',
         'video/mpeg',
         'image/jpeg',
         'image/png',
      ];
      if (supportedTypes.includes(file.mimetype)) {
         cb(null, true);
      } else {
         cb(null, false);
      }
   },
});

router.post('/create', verifyToken, validateData(filmSchema), createFilm);
router.put(
   '/update/:filmId',
   verifyToken,
   validateData(filmSchemaUpdate),
   updateFilm
);
router.post('/upload/:filmId', verifyToken, upload.single('film'), uploadFilm);

router.post(
   '/upload/trailer/:filmId',
   verifyToken,
   upload.single('trailer'),
   uploadTrailer
);

router.post(
   '/poster/:filmId',
   verifyToken,
   upload.single('poster'),
   uploadPoster
);
router.get('/stream/:filmId', streamFilm);
router.get('/stream/:filmId/trailer/:trailerId', verifyToken, streamTrailer);
router.get('/all', verifyToken, fetchFilms);
router.get('/:filmId', verifyToken, fetchFilm);
router.get('/similar/:filmId', verifyToken, fetchSimilarFilms);
// router.put('/:id', verifyToken, updateFilm);
router.put('/add/episode/:id', addEpisode);
router.get('/web/:keys/:t', watchFilmLink2);
router.get('/:keys', watchFilm2);
router.get('/', getFilmWeb);
router.post('/:id', verifyToken, watchFilms);
router.get('/tags', getFilmByTag);
router.get('/search', getFilmBySearch);

router.post('/trailer/:id', verifyToken, watchtrailerFilms);
router.delete('/delete/:filmId', verifyToken, deleteFilm);

export default router;
