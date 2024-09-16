import { GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { s3Client, uploadToBucket, deleteFromBucket } from '@/utils/video.mjs';
import prisma from '@/utils/db.mjs';
import { returnError } from '@/utils/returnError.js';

/**
 * @name isVerifiedAdmin
 * @description Check if the admin is verified
 * @param {String} adminId
 * @param {import("express").Response} res
 * @returns void
 */
async function verifyAdmin(adminId) {
   if (!adminId) {
      const error = new Error(
         'You do not have the right permissions for this action'
      );
      error.statusCode = 401;
      throw error;
   }

   const existingAdmin = await prisma.admin.findUnique({
      where: { id: adminId },
      select: { role: true, deactivated: true },
   });

   if (!existingAdmin) {
      const error = new Error('You cannot perform this action');
      error.statusCode = 400;
      throw error;
   }
   if (existingAdmin.role !== 'admin' || existingAdmin.deactivated) {
      const error = new Error('You are not authorized to perform this action');
      error.statusCode = 401;
      throw error;
   }
}

/**
 * @name checkUploadPermission
 * @description function to check upload permission
 * @param {Express.Request} req
 * @param {Express.Response} res
 * @param {String} adminId
 * @returns  {Promise<File>}
 */

async function checkUploadPermission(req, res, adminId) {
   await verifyAdmin(adminId, res);

   const { filmId } = req.params;

   if (!filmId) {
      return res.status(400).json({ message: 'No film selected' });
   }
   const film = await prisma.film.findUnique({
      where: { id: filmId },
   });

   if (!film) {
      const error = new Error('Film not found');
      error.statusCode = 404;
      throw error;
   }

   // get the file from the request
   const file = req.file;
   if (!file) {
      const error = new Error('No file uploaded');
      error.statusCode = 400;
      throw error;
   }

   return { film, file };
}

/**
 * @name streamVideo
 * @description function to stream video from bucket to client return a video stream
 * @param {Object} params
 * @param {String} params.bucketName
 * @param {String} params.key
 * @param {String} params.range
 * @param {import('express').Response} res
 * @returns {Promise<import('@aws-sdk/client-s3').GetObjectCommandOutput>} stream
 */
export const streamVideo = async ({ bucketName, key, range }, res) => {
   // create stream parameters
   const streamParams = {
      Bucket: bucketName,
      Key: key,
   };

   const data = await s3Client.send(new HeadObjectCommand(streamParams));

   let { ContentLength, ContentType } = data;

   console.log('Data', data);
   console.log('Range', range);
   const CHUNK_SIZE = 10 ** 6; // 1MB

   if (!range) {
      throw new Error('Range header is required');
   }

   // range : bytes=NAN-
   const parts = range.replace(/bytes=/, '').split('-');
   const start = parseInt(parts[0], 10);
   const end = parts[1] ? parseInt(parts[1], 10) : ContentLength - 1;
   // const start = Number(range.replace(/\D/g, ''));
   // const end = Math.min(start + CHUNK_SIZE, ContentLength - 1);

   console.log('Start:', start);
   console.log('End:', end);

   const chunkSize = end - start + 1;
   const headers = {
      'Content-Range': `bytes ${start}-${end}/${ContentLength}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': ContentType,
   };

   console.log('headers', headers);

   // send the headers
   res.writeHead(206, headers);

   // readable stream
   return s3Client.send(
      new GetObjectCommand({
         ...streamParams,
         Range: `bytes=${start}-${end}`,
      })
   );
};

/**
 * @name formatFileSize
 * @description Format file size to human readable format (KB, MB, GB)
 * @param {Number} size
 * @returns {String}
 */
function formatFileSize(size) {
   if (size < 1024) {
      return `${size} B`;
   } else if (size < 1024 ** 2) {
      return `${(size / 1024).toFixed(2)} KB`;
   } else if (size < 1024 ** 3) {
      return `${(size / 1024 ** 2).toFixed(2)} MB`;
   } else {
      return `${(size / 1024 ** 3).toFixed(2)} GB`;
   }
}

/**
 * @name createFilm
 * @description Create a new film
 * @type {import('express').RequestHandler}
 */
export const createFilm = async (req, res, next) => {
   try {
      const { title, overview, plotSummary, releaseDate, adminId } = req.body;

      await verifyAdmin(adminId, res);

      const newFilm = await prisma.film.create({
         data: {
            title,
            overview,
            plotSummary,
            releaseDate: new Date(releaseDate).toISOString(),
         },
      });

      res.status(201).json({
         message: 'Film created successfully',
         film: newFilm,
      });
   } catch (error) {
      if (!error.statusCode) {
         error.statusCode = 500;
      }
      res.status(error.statusCode).json({ message: error.message });
      next(error);
   }
};

/**
 * @name updateFilm
 * @description function to update film details
 * @type {import('express').RequestHandler}
 */
export const updateFilm = async (req, res, next) => {
   try {
      const { filmId } = req.params;
      const { adminId, ...rest } = req.body;

      await verifyAdmin(adminId);

      const updatedFilm = await prisma.film.update({
         where: { id: filmId },
         data: { ...rest },
      });

      res.status(200).json({
         message: 'Film updated successfully',
         film: updatedFilm,
      });
   } catch (error) {
      if (!error.statusCode) {
         error.statusCode = 500;
      }
      res.status(error.statusCode).json({ message: error.message });
      next(error);
   }
};

/**
 * @name upload film to bucket
 * @description function to upload film to bucket and get signed url
 * @type {import('express').RequestHandler}
 */
export const uploadVideo = async (req, res, next) => {
   try {
      const { filmId } = req.params;
      const { adminId, isTrailer } = req.body;
      const { file } = await checkUploadPermission(req, res, adminId);

      const bucketParams = {
         bucketName: filmId,
         key: file.originalname,
         buffer: file.buffer,
         contentType: file.mimetype,
         isPublic: true,
      };

      const data = await uploadToBucket(bucketParams);
      const videoData = {
         url: data.url,
         format: file.mimetype,
         name: file.originalname, // used as the key in the bucket
         size: formatFileSize(file.size),
         encoding: file.encoding,
         isTrailer,
         filmId,
      };

      // create a video record with all the details including the signed url
      const newVideo = await prisma.video.create({
         data: videoData,
      });
      res.status(200).json({ url: 'Upload successful', video: newVideo });
   } catch (error) {
      if (!error.statusCode) {
         error.statusCode = 500;
      }
      res.status(error.statusCode).json({ message: error.message });
      next(error);
   }
};

/**
 * @name streamFilm
 * @description function to stream film from bucket to client
 * @type {import('express').RequestHandler}
 */
export const streamFilm = async (req, res) => {
   try {
      const { trackId } = req.params;

      console.log('FilmId', trackId);

      if (!trackId) {
         returnError('No video id provided', 400);
      }

      // find video related to the film
      const video = await prisma.video.findUnique({
         where: { id: trackId },
         select: {
            id: true,
            name: true,
            film: {
               select: {
                  id: true,
               },
            },
         },
      });

      console.log('Video', video);

      if (!video.id) {
         returnError('Video not found', 404);
      }

      const videoParams = {
         Key: video.name,
         bucketName: video.film.id,
         range: req.headers.range,
      };

      const stream = await streamVideo(videoParams, res);
      stream.Body.pipe(res);
   } catch (error) {
      console.log('Error', error);
      if (!error.statusCode) {
         error.statusCode = 500;
      }
      next(error);
   }
};

/**
 * @name fetchFilms
 * @description function to fetch all films
 * @type {import('express').RequestHandler}
 */
export const fetchFilms = async (req, res, next) => {
   try {
      const query = req.query;

      let options = {
         include: {
            posters: true,
            views: true,
            likes: true,
         },
      };

      // get the donation only films
      if (query.donation) {
         options = {
            ...options,
            include: {
               ...options.include,
               donation: {
                  include: {
                     transaction: true,
                  },
               },
            },
            where: {
               enableDonation: true,
            },
         };
      }

      const films = await prisma.film.findMany({
         ...options,
      });
      res.status(200).json({ films });
   } catch (error) {
      if (!error.statusCode) {
         error.statusCode = 500;
      }
      res.status(error.statusCode).json({ message: error.message });
      next(error);
   }
};

/**
 *
 * @name fetchFilm
 * @description function to fetch a film by id
 * @type {import('express').RequestHandler}
 */
export const fetchFilm = async (req, res, next) => {
   try {
      const { filmId } = req.params;
      if (!filmId) {
         return res.status(400).json({ message: 'No film id provided' });
      }

      const film = await prisma.film.findUnique({
         where: { id: filmId },
         include: {
            posters: true,
            cast: true,
            crew: true,
            video: true,
            watchlist: {
               where: { userId: req.userId, filmId },
            },
            likes: {
               where: { userId: req.userId, filmId },
            },
            views: true,
         },
      });

      if (!film) {
         return res.status(404).json({ message: 'Film not found' });
      }

      res.status(200).json({ film });
   } catch (error) {
      if (!error.statusCode) {
         error.statusCode = 500;
      }

      next(error);
   }
};
/**
 *
 * @name fetchSimilarFilms
 * @description function to fetch similar films
 * @type {import('express').RequestHandler}
 */
export const fetchSimilarFilms = async (req, res, next) => {
   try {
      const { filmId } = req.params;

      if (!filmId) {
         return res.status(400).json({ message: 'No film id provided' });
      }

      console.log('filmId', filmId);

      const film = await prisma.film.findUnique({
         where: { id: filmId },
      });

      console.log('film', film);

      if (!film) {
         return res.status(404).json({ message: 'Film not found' });
      }

      // const posts = await article
      //    .find({ $text: { $search: title } }, { score: { $meta: 'textScore' } })
      //    .sort({ score: { $meta: 'textScore' } })
      //    .limit(5)
      //    .select(['-updated', '-summary', '-featured', '-tags']);

      const similar = await prisma.$runCommandRaw(`
            db.getCollection('articles').find(
            { $text: { $search: ${film.overview} } },
            { score: { $meta: 'textScore' } }
         )
         .sort({ score: { $meta: 'textScore' } })
         .limit(5)
         .project({ updated: 0, summary: 0, featured: 0, tags: 0 })
         .toArray()
  `);

      console.log('similar', similar);

      // const similarFilms = await prisma.film.findMany({
      //    where: {
      //       // id: { $not: filmId },
      //       $text: { $search: film.title },
      //       score: { $meta: 'textScore' },
      //    },
      //    include: {
      //       posters: true,
      //       trailers: true,
      //    },
      //    orderBy: { score: { $meta: 'textScore' } },
      //    take: 5,
      // });

      res.status(200).json({ films: similarFilms });
   } catch (error) {
      if (!error.statusCode) {
         error.statusCode = 500;
      }
      res.status(error.statusCode).json({ message: error.message });
   }
};

/**
 *
 * @name addPosters
 * @description function to add posters to film
 * @type {import('express').RequestHandler}
 */
export const uploadPoster = async (req, res, next) => {
   try {
      const { filmId } = req.params;
      const { adminId, isCover, isBackdrop } = req.body;

      const { file: poster } = await checkUploadPermission(req, res, adminId);

      console.log('poster', poster);

      const bucketParams = {
         bucketName: filmId,
         key: poster.originalname,
         buffer: poster.buffer,
         contentType: poster.mimetype,
         isPublic: true,
      };

      const data = await uploadToBucket(bucketParams);
      const posterData = {
         url: data.url,
         type: poster.mimetype,
         isCover: isCover === 'true' ? true : false,
         isBackdrop: isBackdrop === 'true' ? true : false,
         filmId,
      };

      // create a new poster
      const newPoster = await prisma.poster.create({
         data: posterData,
      });

      res.status(201).json({
         poster: newPoster,
         message: 'Poster added successfully',
      });
   } catch (error) {
      if (!error.statusCode) {
         error.statusCode = 500;
      }
      res.status(error.statusCode).json({ message: error.message });
      next(error);
   }
};

/**
 *
 * @name getVideoSource - get video source
 * @description function to get video source from the bucket
 * @type {import('express').RequestHandler}
 */

export const getVideoSource = async (req, res, next) => {
   try {
      const { trackid } = req.params;

      if (!trackid) {
         returnError('Unauthorized', 401);
      }

      const video = await prisma.video.findFirst({
         where: {
            id: trackid,
         },
      });

      if (!video) {
         returnError('Video not found', 404);
      }

      return res.status(200).json({ message: 'ok', video });
   } catch (error) {
      if (!error.statusCode) {
         error.statusCode = 500;
      }
      next(error);
   }
};

/**
 * @name bookmark - get video source
 * @description function to get video source from the bucket
 * @type {import('express').RequestHandler}
 */
export const bookmark = async (req, res, next) => {};

/**
 * @name addWatchList - Add to the watchlist
 * @description function to add a film to the watchlist
 * @type {import('express').RequestHandler}
 */
export const addWatchList = async (req, res, next) => {
   try {
      const { filmId, userId } = req.params;
      console.log('FilmId', filmId, userId);

      if (!filmId || !userId) {
         returnError('Unauthorized', 401);
      }

      // check if the film is already in the watchlist
      const filmExists = await prisma.watchlist.findFirst({
         where: {
            filmId,
            userId,
         },
      });

      if (filmExists) {
         return res.status(200).json({ message: 'Film already in watchlist' });
      }

      await prisma.watchlist.create({
         data: {
            user: {
               connect: {
                  id: userId,
               },
            },
            film: {
               connect: {
                  id: filmId,
               },
            },
         },
      });

      return res.status(200).json({ message: 'Added to watchlist' });
   } catch (error) {
      if (!error.statusCode) {
         error.statusCode = 500;
      }
      next(error);
   }
};

/**
 * @name getWatchList - get watchlist
 * @description function to get watchlist
 * @type {import('express').RequestHandler}
 */
export const getWatchList = async (req, res, next) => {
   try {
      const { userId } = req.params;
      const { limit } = req.query;

      if (!userId) {
         returnError('Unauthorized', 401);
      }

      let watchlist = await prisma.watchlist.findMany({
         where: { userId },
         select: {
            id: true,
            type: true,
            film: {
               select: {
                  id: true,
                  title: true,
                  type: true,
                  posters: true,
                  releaseDate: true,
               },
            },
         },
         take: limit ? parseInt(limit) : 20, // default limit is 20
      });

      // format the watchlist to only show the id and some film details
      if (watchlist?.length > 0) {
         watchlist = watchlist.reduce((acc, curr) => {
            if (!acc[curr.type]) {
               acc[curr.type] = [];
            }

            const film = {
               id: curr.film.id,
               title: curr.film.title,
               releaseDate: curr.film.releaseDate,
               poster: curr.film?.posters[0] ?? null,
               type: curr.film.type,
            };
            acc[curr.type].push(film);
            return acc;
         }, {});
      }

      return res.status(200).json({ watchlist });
   } catch (error) {
      if (!error.statusCode) {
         error.statusCode = 500;
      }
      next(error);
   }
};
/**
 * @name removeFromWatchlist - get watchlist
 * @description function to remove film from watchlist
 * @type {import('express').RequestHandler}
 */
export const removeFromWatchlist = async (req, res, next) => {
   try {
      const { id, userId } = req.params;

      if (!userId) {
         returnError('Unauthorized', 401);
      }

      const item = await prisma.watchlist.findUnique({
         where: {
            id,
         },
      });

      if (!item) {
         return res.status(404).json({ message: 'Item not found' });
      }

      await prisma.watchlist.delete({
         where: {
            id,
         },
      });

      return res.status(200).json({ message: 'Removed from watchlist' });
   } catch (error) {
      if (!error.statusCode) {
         error.statusCode = 500;
      }
      next(error);
   }
};

/**
 * @name likeRateFilm - like or dislike a film
 * @description function to like or dislike a film
 * @type {import('express').RequestHandler}
 */
export const likeRateFilm = async (req, res, next) => {
   try {
      const { filmId, userId } = req.params;
      const data = req.body; // { likeType: "THUMBS_UP" or "THUMBS_DOWN" or "NONE" }

      if (!filmId || !userId) {
         returnError('Unauthorized', 401);
      }

      // check if the film is already liked
      const filmExists = await prisma.likes.findFirst({
         where: {
            filmId,
            userId,
         },
      });

      if (filmExists) {
         // change the like status to the selected status
         await prisma.likes.update({
            where: {
               id: filmExists.id,
            },
            data: {
               type: data.likeType, //"THUMBS_UP" or "THUMBS_DOWN" or "NONE"
            },
         });
      } else {
         await prisma.likes.create({
            data: {
               user: {
                  connect: {
                     id: userId,
                  },
               },
               film: {
                  connect: {
                     id: filmId,
                  },
               },
               type: data.likeType, // "THUMBS_UP" or "THUMBS_DOWN" or "NONE"
            },
         });
      }

      return res.status(200).json({ message: 'ok' });
   } catch (error) {
      if (!error.statusCode) {
         error.statusCode = 500;
      }
      next(error);
   }
};

export const addEpisode = async (req, res, next) => {
   try {
      const paramsId = req.params.id;

      let getFilmss = await filmModels.findById(paramsId);

      if (!getFilmss) {
         console.log('error', 'film not found');
      } else if (
         getFilmss.filmType !== 'series' &&
         getFilmss.filmType !== 'TV series'
      ) {
         console.log('error', 'film not series');
      }

      let firstSeason = {
         seasonTitle: 'Season 1',
         seasonCounter: '1',
         totalEpisodes: '13',
         episodes: [
            {
               episodeId: '6654912f36470e427423ebf0',
            },
            {
               episodeId: '6654942036470e427423ebf3',
            },
            {
               episodeId: '6654942e36470e427423ebf4',
            },
            {
               episodeId: '6654943936470e427423ebf5',
            },
            {
               episodeId: '6654944a36470e427423ebf6',
            },
            {
               episodeId: '6654945736470e427423ebf7',
            },
            {
               episodeId: '6654947236470e427423ebf8',
            },
            {
               episodeId: '6654947d36470e427423ebf9',
            },
            {
               episodeId: '6654948f36470e427423ebfa',
            },
            {
               episodeId: '6654949a36470e427423ebfb',
            },
            {
               episodeId: '665494a836470e427423ebfc',
            },
            {
               episodeId: '665494b636470e427423ebfd',
            },
            {
               episodeId: '665494c536470e427423ebfe',
            },
         ],
      };

      getFilmss.seasons = [firstSeason];

      console.log(getFilmss);
      await getFilmss.save();
      console.log(getFilmss);
      res.status(200).json('saved');
   } catch (error) {
      if (!error.statusCode) {
         error.statusCode = 500;
      }
      next(error);
   }
};

export const getFilmWeb = async (req, res, next) => {
   try {
      // const getallFilms = await filmModels.find().exec((err, films) => {
      //   if (err) {
      //     console.log(err);
      //     return;
      //   }

      //   if (!films || films.length === 0) {
      //     console.log("Authors not found");
      //     return;
      //   }

      //   films.forEach(film => {
      //     if (film.seasons && film.seasons.length > 0) {
      //       filmModels.populate(film, { path: "episodeId" }, (err, populatedData) => {
      //        if (err) {
      //          console.error(err);
      //          return;
      //         }
      //          console.log("Populated Data:", populatedData);
      //       })
      //     }
      //   })
      // })

      // const getallFilms = await filmModels
      //   .find({ filmType: "movie" })
      //   .populate("seasons.episodes.episodeId");
      const getallData = await filmModels
         .find()
         .populate('seasons.episodes.episodeId');

      const allFilms = [...getallData];

      //console.log("getall", getallSeries);
      res.status(200).json({
         items: allFilms,
      });
   } catch (error) {
      if (!error.statusCode) {
         error.statusCode = 500;
      }
      next(error);
   }
};

export const getSingleFilm = async (req, res, next) => {
   try {
      let paramsId = req.params.id;

      let excludedFields = '-fullVideoLink ';
      // const getSingleFilm = await filmModels
      //   .findById({ _id: paramsId })
      //   .select(excludedFields);
      const getSingleFilm = await filmModels
         .findById({ _id: paramsId })
         .populate('seasons.episodes.episodeId');

      if (!getSingleFilm) {
         const error = new Error('No Film Found!!');
         error.statusCode = 404;
         throw error;
      }

      res.status(200).json({ film: getSingleFilm });
   } catch (error) {
      if (!error.statusCode) {
         error.statusCode = 500;
      }
      next(error);
   }
};

//get film by tag
export const getFilmBySearch = async (req, res, next) => {
   try {
      const query = req.query.q;

      const getfilms = await filmModels
         .find({ title: { $regex: query, $options: 'i' } })
         .limit(40);
      res.status(200).json(getfilms);
   } catch (error) {
      if (!error.statusCode) {
         error.statusCode = 500;
      }
      next(error);
   }
};

/**
 *
 * @name deleteFilm
 * @description function to delete a film
 * @type {import('express').RequestHandler}
 */
export const deleteFilm = async (req, res, next) => {
   try {
      const { filmId } = req.params;
      const { adminId } = req.body;

      await verifyAdmin(adminId, res);

      const videos = await prisma.video.findMany({
         where: { filmId },
      });

      console.log('videos', videos, filmId);

      if (videos.length > 0) {
         for (let video of videos) {
            await deleteFromBucket({ bucketName: filmId, key: video.name });
         }
      } else {
         return res.status(404).json({ message: 'No videos found' });
      }

      const film = await prisma.film.delete({
         where: { id: filmId },
      });

      res.status(200).json({
         film,
         message: `Deleted ${film.title} successfully`,
      });
   } catch (error) {
      if (!error.statusCode) {
         error.statusCode = 500;
      }
      res.status(error.statusCode).json({ message: error.message });
      next(error);
   }
};
