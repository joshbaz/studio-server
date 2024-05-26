import express from "express";
import { addFilm, getFilmBySearch, getFilmByTag, getFilmWeb, getSingleFilm, updateFilm,  watchFilm2, watchFilmLink, watchFilms, watchtrailerFilms } from "../1-controllers/filmControllers.js";
import { verifyToken } from "../4-middleware/verifyToken.js";
import multer from "multer";
const router = express.Router();
import dotenv from "dotenv";
dotenv.config();


const upload = multer({
    storage: multer.memoryStorage()
})

router.post("/create", upload.single("film"), addFilm);
router.put("/:id", verifyToken, updateFilm);
router.get("/web/:keys/:t", watchFilmLink);
router.get("/:keys", watchFilm2);
router.get("/", getFilmWeb)
router.get("/sfilm/:id", getSingleFilm)
router.post("/:id", verifyToken, watchFilms);
router.get("/tags", getFilmByTag);
router.get("/search", getFilmBySearch);

router.post("/trailer/:id", verifyToken, watchtrailerFilms);


export default router