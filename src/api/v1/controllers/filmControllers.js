import { GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { s3Client, uploadToBucket, deleteFromBucket } from '@/utils/video.mjs';
import prisma from '@/utils/db.mjs';

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
      console.log('No headers - starts here');
      let start = 0;
      let end = Math.min(start + CHUNK_SIZE, ContentLength - 1);
      console.log('end', end);
      while (start < ContentLength) {
         const ranges = `bytes=${start}-${end}`;
         const headers = {
            'Content-Range': `${ranges}/${ContentLength}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': end - start + 1,
            'Content-Type': ContentType,
         };

         res.writeHead(206, headers);
         start = end;

         if (start < ContentLength) {
            res.flushHeaders(); // Send the chunk immediately
         }

         return s3Client.send(
            new GetObjectCommand({ ...streamParams, Range: ranges })
         );
         // s3Cli.send(
         //    new GetObjectCommand({ ...streamParams, Range: ranges }),
         //    (err, streamData) => {
         //       if (err) {
         //          res.status(500).json('error');
         //       }
         //       let stream = streamData.Body;
         //       res.write(stream);
         //       start = end;
         //       end = Math.min(start + MAX_CHUNK_SIZE, ContentLength);
         //       if (start < ContentLength) {
         //          res.flushHeaders(); // Send the chunk immediately
         //       }
         //    }
         // );
      }

      res.end();
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
      const { filmId } = req.params;

      const film = await prisma.film.findUnique({
         where: { id: filmId },
      });

      if (!film) {
         return res.status(404).json({ message: 'Film not found' });
      }

      // find video related to the film
      const video = await prisma.video.findFirst({
         where: { filmId },
      });

      if (!video) {
         return res.status(404).json({ message: 'No video found' });
      }

      const stream = await streamVideo(
         { bucketName: filmId, key: video.name, range: req.headers.range },
         res
      );

      stream.Body.pipe(res);
   } catch (error) {
      if (!error.statusCode) {
         error.statusCode = 500;
      }
      return res.status(error.statusCode).json({ message: error.message });
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
            stats: true,
            video: true,
            watchlist: {
               where: { userId: req.userId },
            },
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

      const video = await prisma.video.findFirst({
         where: {
            id: trackid,
         },
      });

      if (!video) {
         return res.status(404).json({ message: 'Video not found' });
      }

      return res.status(200).json({ message: 'Video source', video });
   } catch (error) {
      if (!error.statusCode) {
         error.statusCode = 500;
      }
      res.status(error.statusCode).json({ message: error.message });
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

      if (!filmId || !userId) {
         return res.status(400).json({ message: 'Film or user not found' });
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
            filmId,
            userId,
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
         return res.status(400).json({ message: 'User not found' });
      }

      const watchlist = await prisma.watchlist.findMany({
         where: {
            userId,
         },
         include: {
            film: {
               include: {
                  posters: true,
               },
            },
         },
         take: limit ? parseInt(limit) : 20, // default limit is 20
      });

      // format the watchlist to only show the id and some film details
      const formattedWatchlist = watchlist.map((item) => {
         return {
            id: item.film.id,
            title: item.film.title,
            releaseDate: item.film.releaseDate,
            posters: item.film.posters,
            type: item.film.type,
         };
      });

      return res.status(200).json({ watchlist: formattedWatchlist });
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
