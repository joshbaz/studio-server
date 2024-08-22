import express from 'express';
import {
   createFilm,
   getFilmBySearch,
   streamFilm,
   updateFilm,
   uploadVideo,
   fetchFilms,
   deleteFilm,
   uploadPoster,
   fetchFilm,
   fetchSimilarFilms,
   getVideoSource,
   addWatchList,
   getWatchList,
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
router.post('/upload/:filmId', verifyToken, upload.single('film'), uploadVideo);

router.post(
   '/poster/:filmId',
   verifyToken,
   upload.single('poster'),
   uploadPoster
);
router.post('/watchlist/:filmId/:userId', verifyToken, addWatchList);

router.get('/stream/:filmId', streamFilm);
router.get('/all', fetchFilms);
router.get('/:filmId', verifyToken, fetchFilm);
router.get('/similar/:filmId', verifyToken, fetchSimilarFilms);
router.get('/track/:trackid', getVideoSource);
router.get('/watchlist/:userId', verifyToken, getWatchList);
router.get('/search', getFilmBySearch);

router.delete('/delete/:filmId', verifyToken, deleteFilm);

export default router;
