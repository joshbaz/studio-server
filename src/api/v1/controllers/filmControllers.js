import {
   S3Client,
   GetObjectCommand,
   HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { env } from '@/env.mjs';
import { s3Client, uploadToBucket, deleteFromBucket } from '@/utils/video.mjs';
import prisma from '@/utils/db.mjs';

const s3 = new S3Client({
   region: 'fra1',
   credentials: {
      accessKeyId: env.DO_SPACEACCESSKEY,
      secretAccessKey: env.DO_SPACESECRETKEY,
   },
   endpoint: env.DO_SPACESENDPOINT,
   forcePathStyle: true,
});

/**
 * @name isVerifiedAdmin
 * @description Check if the admin is verified
 * @param {String} adminId
 * @param {import("express").Request} res
 * @returns void
 */
async function isVerifiedAdmin(adminId, res) {
   const existingAdmin = await prisma.admin.findUnique({
      where: { id: adminId },
      select: { role: true, deactivated: true },
   });
   if (!existingAdmin) {
      return res
         .status(404)
         .json({ message: 'You cannot perform this action' });
   }
   if (existingAdmin.role !== 'admin' || existingAdmin.deactivated) {
      return res
         .status(403)
         .json({ message: 'You are not authorized to perform this action' });
   }
}

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

      await isVerifiedAdmin(adminId, res);

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

      await isVerifiedAdmin(adminId, res);

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
export const uploadFilm = async (req, res, next) => {
   try {
      const { filmId } = req.params;
      const { adminId } = req.body;

      await isVerifiedAdmin(adminId, res);

      const film = await prisma.film.findUnique({
         where: { id: filmId },
      });
      if (!film) {
         return res.status(404).json({ message: 'Film not found' });
      }

      // get the file from the request
      const file = req.file;
      if (!file) {
         return res.status(400).json({ message: 'No file uploaded' });
      }

      const bucketParams = {
         bucketName: filmId,
         key: file.originalname,
         buffer: file.buffer,
         contentType: file.mimetype,
      };

      const data = await uploadToBucket(bucketParams);
      const videoData = {
         url: data.url,
         format: file.mimetype,
         name: file.originalname, // used as the key in the bucket
         size: formatFileSize(file.size),
         encoding: file.encoding,
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
export const streamFilm = async (req, res, next) => {
   try {
      const { filmId } = req.params;
      const range = req.headers.range;

      if (!range) {
         return res.status(400).json({ message: 'Range header is required' });
      }

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

      // create stream parameters
      const streamParams = {
         Bucket: filmId,
         Key: video.name,
      };

      const data = await s3Client.send(new HeadObjectCommand(streamParams));

      let { ContentLength, ContentType } = data;

      // const parts = range.replace(/bytes=/, '').split('-');
      // const start = parseInt(parts[0], 10);
      // const end = parts[1] ? parseInt(parts[1], 10) : ContentLength - 1;

      // console.log('start', start, 'end', end);

      const CHUNK_SIZE = 20 ** 6; // 2MB
      const start = Number(range.replace(/\D/g, ''));
      const end = Math.min(start + CHUNK_SIZE, ContentLength - 1);

      const chunkSize = end - start + 1;
      const headers = {
         'Content-Range': `bytes ${start}-${end}/${ContentLength}`,
         'Accept-Ranges': 'bytes',
         'Content-Length': chunkSize,
         'Content-Type': ContentType,
      };

      // send the headers
      res.writeHead(206, headers);

      // readable stream
      const stream = await s3Client.send(
         new GetObjectCommand({
            ...streamParams,
            Range: `bytes=${start}-${end}`,
         })
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

export const fetchFilms = async (_, res, next) => {
   try {
      const films = await prisma.film.findMany();
      res.status(200).json({ films });
   } catch (error) {
      if (!error.statusCode) {
         error.statusCode = 500;
      }
      res.status(error.statusCode).json({ message: error.message });
      next(error);
   }
};

export const addFilm = async (req, res, next) => {
   try {
      const {
         createdBy,
         title,
         audioLanguage,
         embeddedSubtitles,
         runtime,
         YearOfProduction,
         genre,
         tags,
         plotSummary,
         plotSynopsis,
         cast,
         directors,
         producers,
         writers,
         soundcore,
         auidencetarget,
         auidenceAgeGroup,
         visibility,
      } = req.body;
      console.log('req.body', req.body, req.file);

      const params = {
         Bucket: bucketName,
         Key: req.file.originalname,
         Body: req.file.buffer,
         ContentType: req.file.mimetype,
         // acl: "public-read",
      };

      //         const uploadUrl = await s3.getSignedUrlPromise("putObject", params);
      //         console.log('url',uploadUrl);
      // res.status(200).json({ url: uploadUrl });
      s3.upload(params, (error, data) => {
         if (error) {
            console.error(error);
            res.sendStatus(500);
            return;
         }
         console.log('given', data);
         res.status(201).json(data);
      });
      // upload(req, res, function (error, values) {
      //   if (error) {
      //     console.log(error);
      //     return
      //     }

      //   console.log("File uploaded successfully.", values);
      //     //response.redirect("/success");
      //     res.status(200).json("done")
      // });
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

export const watchFilm = async (req, res, next) => {
   try {
      const range = req.headers.range;
      if (!range) {
         res.status(400).send('Requires Range header');
      }

      let streamParams = {
         Bucket: bucketName,
         Key: '🎧Electronic Music.mp4',
      };

      const data = await s3.send(new HeadObjectCommand(streamParams));

      console.log('data', data);

      s3.HeadObjectCommand(streamParams, async (err, data) => {
         if (err) {
            console.log(err);
            return res.status(500).end('Internal Server Error');
         }
         console.log('here');
         let { ContentLength, ContentType, AcceptRanges } = data;
         const CHUNK_SIZE = 10 ** 6;
         if (range) {
            const parts = range.replace(/bytes=/, '').split('-');
            console.log('starts here', parts);
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : ContentLength - 1;

            const chunkSize = end - start + 1;
            const headers = {
               'Content-Range': `bytes ${start}-${end}/${ContentLength}`,
               'Accept-Ranges': 'bytes',
               'Content-Length': chunkSize,
               'Content-Type': ContentType,
            };

            res.writeHead(206, headers);

            //readable stream
            const stream = s3
               .getObject({ ...streamParams, Range: `bytes=${start}-${end}` })
               .createReadStream();

            stream.pipe(res);
         } else {
            console.log('No headers - starts here');
            //no range provided.
            const headers = {
               'Content-Length': ContentLength,
               'Content-Type': ContentType,
            };

            res.writeHead(200, headers);
            s3.getObject(streamParams).createReadStream().pipe(res);
         }
         //   const videoPath = getURL;
         //   const videoSize = ContentLength;
         //   const CHUNK_SIZE = 10 ** 6; //1MB
         //   const start = Number(range.replace(/\D/g, ""));
         //   const end = Math.min(start + CHUNK_SIZE, videoSize - 1);
         //   const contentLength = end - start + 1;
         //   console.log("end", end, start, contentLength);
         //   const headers = {
         //     "Content-Range": `bytes ${start}-${end}/${videoSize}`,
         //     "Accept-Ranges": "bytes",
         //     "Content-Length": contentLength,
         //     "Content-Type": "video/mp4",
         //   };

         //   res.writeHead(206, headers);
         //   await pipeline(  res)
         //   const videoStream = fs.createReadStream(videoPath, { start, end });
         //   videoStream.pipe(res);
         // return { ContentLength, ContentType, AcceptRanges };
      });
   } catch (error) {
      if (!error.statusCode) {
         error.statusCode = 500;
      }
      next(error);
   }
};

//watchlinks
// const generatePreSignedUrl = async (bucketName, key, expiration = 300) => {
//   const params = {
//     Bucket: bucketName,
//     Key: key,
//     Expires: expiration, // URL expiration time in seconds (default is 300 seconds)
//   };

//   try {
//     const url = await s3.getSignedUrlPromise("getObject", params);
//     return url;
//   } catch (error) {
//     console.error("Error generating pre-signed URL:", error);
//     throw error;
//   }
// };

// const getObjectMetadata = async (bucketName, key) => {
//   const params = {
//     Bucket: bucketName,
//     Key: key,
//   };

//   try {
//     const metadata = await s3.headObject(params).promise();
//     console.log(metadata, "meta");
//     return metadata;
//   } catch (error) {
//     console.error("Error getting object metadata:", error);
//     throw error;
//   }
// };

export const watchFilmLink2 = async (req, res, next) => {
   try {
      const range = req.headers.range;
      if (!range) {
         res.status(400).send('Requires Range header');
      }

      const s3Cli = new S3Client({
         region: 'fra1',
         credentials: {
            accessKeyId: process.env.DS_AccessKey,
            secretAccessKey: process.env.DS_SecretKey,
         },
         endpoint: spacesEndpoint,
         forcePathStyle: false,
      });

      let getId = req.params.keys;
      let gett = req.params.t;

      let videoType;

      if (gett === 'trailer') {
         videoType === 'localTrailer';
      } else if (gett === 'film') {
         videoType === 'fullVideoLink';
      } else if (gett !== 'trailer' && gett !== 'film') {
         videoType === null;
      }

      const getSingleFilm = await filmModels
         .findById({ _id: getId })
         .select(videoType);

      if (!getSingleFilm) {
         const error = new Error('No Film Found!!');
         error.statusCode = 404;
         throw error;
      }

      let selectedVideoLink;

      if (gett === 'trailer' && getSingleFilm.localTrailer) {
         selectedVideoLink = getSingleFilm.localTrailer;
      } else if (gett === 'film' && getSingleFilm.fullVideoLink) {
         selectedVideoLink = getSingleFilm.fullVideoLink;
      } else if (gett !== 'trailer' && gett !== 'film') {
         console.log('videiewewe');
         const error = new Error('Ooops, video not found!!');
         error.statusCode = 404;
         throw error;
      }

      let removeURLString = (inputString, stringToRemove) => {
         const regex = new RegExp(stringToRemove, 'g');

         const resultString = inputString.replace(regex, '');

         return resultString;
      };

      let decodeUrl = (urlString) => {
         const decodedUrl = decodeURIComponent(urlString);
         return removeURLString(decodedUrl, process.env.removeLink);
      };

      let passedKey = decodeUrl(selectedVideoLink);

      let streamParams = {
         Bucket: bucketName,
         Key: passedKey,
      };

      console.log('teryung');

      // let objectRetrieval = new GetObjectCommand(streamParams, (err, data) => {
      //   console.log("err");
      //   console.log("dta", data);
      // });
      // console.log("resData", objectRetrieval);
      s3Cli.send(new GetObjectCommand(streamParams), (err, data) => {
         if (err) {
            //console.log("err", err.errno)
            return res.status(500).json(err.message);
         }
         let { ContentLength, ContentType, AcceptRanges } = data;
         console.log('data', ContentLength);
         const CHUNK_SIZE = 10 ** 6;
         const MAX_CHUNK_SIZE = 100 * 1024 * 1024; // 10 MB - 10 * 1024 * 1024
         if (range) {
            console.log('data', ContentLength);
            const parts = range.replace(/bytes=/, '').split('-');
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : ContentLength - 1;
            const chunkSize = end - start + 1;
            const headers = {
               'Content-Range': `bytes ${start}-${end}/${ContentLength}`,
               'Accept-Ranges': 'bytes',
               'Content-Length': chunkSize,
               'Content-Type': ContentType,
            };
            res.writeHead(206, headers);

            s3Cli.send(
               new GetObjectCommand({
                  ...streamParams,
                  Range: `bytes=${start}-${end}`,
               }),
               (err, streamData) => {
                  if (err) {
                     res.status(500).json('error');
                  }
                  let stream = streamData.Body;
                  console.log('stream');
                  stream.pipe(res);
               }
            );
         } else {
            console.log('No headers - starts here');
            let start = 0;
            let end = Math.min(MAX_CHUNK_SIZE, ContentLength);
            while (start < ContentLength) {
               const ranges = `bytes=${start}-${end - 1}`;
               s3Cli.send(
                  new GetObjectCommand({ ...streamParams, Range: ranges }),
                  (err, streamData) => {
                     if (err) {
                        res.status(500).json('error');
                     }
                     let stream = streamData.Body;
                     res.write(stream);
                     start = end;
                     end = Math.min(start + MAX_CHUNK_SIZE, ContentLength);
                     if (start < ContentLength) {
                        res.flushHeaders(); // Send the chunk immediately
                     }
                  }
               );
            }

            res.end();
         }
      });

      //  res.writeHead(200, {
      //    "Content-Type": "video/mp4",
      //  });
      //  console.log("bodu");
      //  const videoStream = Readable.from(Body);
      //  videoStream.pipe(res);
      // console.log("resData22", resData.ContentLength);
   } catch (error) {
      if (!error.statusCode) {
         error.statusCode = 500;
      }
      next(error);
   }
};

// export const watchFilmLink = async (req, res, next) => {
//   try {
//     const range = req.headers.range;
//     if (!range) {
//       res.status(400).send("Requires Range header");
//     }

//     const s3Cli = new S3Client({
//       region: "fra1",
//       credentials: {
//         accessKeyId: process.env.DS_AccessKey,
//         secretAccessKey: process.env.DS_SecretKey,
//       },
//       endpoint: spacesEndpoint,
//       forcePathStyle: false,
//     });

//     let getId = req.params.keys;
//     let gett = req.params.t;
//     console.log("gett", getId, gett);
//     let videoType;

//     if (gett === "trailer") {
//       videoType === "localTrailer";
//     } else if (gett === "film") {
//       videoType === "fullVideoLink";
//     } else if (gett !== "trailer" && gett !== "film") {
//       videoType === null;
//     }

//     const getSingleFilm = await filmModels
//       .findById({ _id: getId })
//       .select(videoType);
//     // console.log("gett", getSingleFilm);
//     if (!getSingleFilm) {
//       const error = new Error("No Film Found!!");
//       error.statusCode = 404;
//       throw error;
//     }

//     // let key = "films/Fate(2006)/Video/Fair Play_360p.mp4";
//     //     const metadata = await getObjectMetadata(bucketName, key);

//     //     const url = await generatePreSignedUrl(bucketName, key);

//     //      res.set({
//     //        "Content-Type": metadata.ContentType,
//     //        "Content-Length": metadata.ContentLength,
//     //        "Accept-Ranges": "bytes",
//     //      });

//     // res.redirect(url);
//     let selectedVideoLink;
//    // console.log("videi4", getSingleFilm);

//     if (gett === "trailer" && getSingleFilm.localTrailer) {
//       selectedVideoLink = getSingleFilm.localTrailer;
//     } else if (gett === "film" && getSingleFilm.fullVideoLink) {
//       selectedVideoLink = getSingleFilm.fullVideoLink;
//     } else if (gett !== "trailer" && gett !== "film") {
//       console.log("videiewewe");
//       const error = new Error("Ooops, video not found!!");
//       error.statusCode = 404;
//       throw error;
//     }
//     // if (videoType === "localTrailer" && getSingleFilm.localTrailer) {
//     //   selectedVideoLink = getSingleFilm.localTrailer;
//     //   console.log("videi");
//     // } else if (videoType === "fullVideoLink" && getSingleFilm.fullVideoLink) {
//     //   console.log("videi");
//     //   selectedVideoLink = getSingleFilm.fullVideoLink;
//     // } else if (
//     //   (videoType !== "localTrailer" && !getSingleFilm.localTrailer) &&
//     //   (videoType !== "fullVideoLink" && getSingleFilm.fullVideoLink)
//     // ) {
//     //   console.log("videiewewe");
//     //   const error = new Error("Ooops, video not found!!");
//     //   error.statusCode = 404;
//     //   throw error;
//     // }

//     let removeURLString = (inputString, stringToRemove) => {
//       const regex = new RegExp(stringToRemove, "g");

//       const resultString = inputString.replace(regex, "");

//       return resultString;
//     };
//     let decodeUrl = (urlString) => {
//       const decodedUrl = decodeURIComponent(urlString);
//       return removeURLString(
//         decodedUrl,
//         "https://nyat-streams.fra1.cdn.digitaloceanspaces.com"
//       );
//     };

//     let passedKey = decodeUrl(selectedVideoLink);

//     console.log("key0", passedKey);

//     let streamParams = {
//       Bucket: bucketName,
//       Key: passedKey,
//     };

//     //console.log("videossss", getSingleFilm);
//     let objectRetrieval = new GetObjectCommand(streamParams,);
//     let objectHead = new HeadObjectCommand(streamParams);
//   //  console.log("Object", objectRetrieval);
//     console.log("objectHead", objectHead)
//     let resData = await s3Cli.send(objectHead);

// console.log("resData", resData.ContentLength)

//     console.log("vide234o", getSingleFilm);
//    // console.log("data", data);
//     s3.getObject(streamParams, async (err, data) => {
//       if (err) {
//         console.log(err);
//         return res.status(500).end("Internal Server Error");
//       }
//       console.log("streamParams", data);
//       let { ContentLength, ContentType, AcceptRanges } = data;
//       const CHUNK_SIZE = 10 ** 6;
//       const MAX_CHUNK_SIZE = 100 * 1024 * 1024; // 10 MB - 10 * 1024 * 1024
//       if (range) {
//         const parts = range.replace(/bytes=/, "").split("-");
//         console.log("starts here", parts);
//         const start = parseInt(parts[0], 10);
//         const end = parts[1] ? parseInt(parts[1], 10) : ContentLength - 1;

//         const chunkSize = end - start + 1;
//         const headers = {
//           "Content-Range": `bytes ${start}-${end}/${ContentLength}`,
//           "Accept-Ranges": "bytes",
//           "Content-Length": chunkSize,
//           "Content-Type": ContentType,
//         };

//         res.writeHead(206, headers);

//         //readable stream
//         const stream = s3
//           .getObject({ ...streamParams, Range: `bytes=${start}-${end}` })
//           .createReadStream();

//         stream.pipe(res);
//       } else {
//         console.log("No headers - starts here");
//         //no range provided.
//         let start = 0;
//         let end = Math.min(MAX_CHUNK_SIZE, ContentLength);

//         // const headers = {
//         //   "Content-Range": `bytes ${start}-${end}/${ContentLength}`,
//         //   "Accept-Ranges": "bytes",
//         //   "Content-Length": chunkSize,
//         //   "Content-Type": ContentType,
//         // };
//         while (start < ContentLength) {
//           const ranges = `bytes=${start}-${end - 1}`;
//           const data = await s3
//             .getObject({ ...streamParams, Range: ranges })
//             .promise();
//           res.write(data.Body);

//           start = end;
//           end = Math.min(start + MAX_CHUNK_SIZE, ContentLength);

//           if (start < ContentLength) {
//             res.flushHeaders(); // Send the chunk immediately
//           }
//         }

//         res.end();
//         //s3.getObject(streamParams).createReadStream().pipe(res);
//         //  await pipelineAsync(
//         //    s3.getObject(streamParams).createReadStream(),
//         //    res
//         //  );
//       }
//     });
//     //console.log("getSize", getSize.ContentLength)
//   } catch (error) {
//     if (!error.statusCode) {
//       error.statusCode = 500;
//     }
//     next(error);
//   }
// };
//key experiment
export const watchFilm2 = async (req, res, next) => {
   try {
      const range = req.headers.range;
      if (!range) {
         res.status(400).send('Requires Range header');
      }

      let streamParams = {
         Bucket: bucketName,
         Key: req.params.keys,
      };

      const data = await s3.send(new HeadObjectCommand(streamParams));

      console.log('data', data);
      s3.HeadObjectCommand(streamParams, async (err, data) => {
         if (err) {
            console.log(err);
            return res.status(500).end('Internal Server Error');
         }
         let { ContentLength, ContentType, AcceptRanges } = data;
         const CHUNK_SIZE = 10 ** 6;
         const MAX_CHUNK_SIZE = 10 * 1024 * 1024; // 10 MB
         if (range) {
            const parts = range.replace(/bytes=/, '').split('-');
            console.log('starts here', parts);
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : ContentLength - 1;

            const chunkSize = end - start + 1;
            const headers = {
               'Content-Range': `bytes ${start}-${end}/${ContentLength}`,
               'Accept-Ranges': 'bytes',
               'Content-Length': chunkSize,
               'Content-Type': ContentType,
            };

            res.writeHead(206, headers);

            //readable stream
            const stream = s3
               .getObject({ ...streamParams, Range: `bytes=${start}-${end}` })
               .createReadStream();

            stream.pipe(res);
         } else {
            console.log('No headers - starts here');
            //no range provided.
            let start = 0;
            let end = Math.min(MAX_CHUNK_SIZE, ContentLength);

            // const headers = {
            //   "Content-Range": `bytes ${start}-${end}/${ContentLength}`,
            //   "Accept-Ranges": "bytes",
            //   "Content-Length": chunkSize,
            //   "Content-Type": ContentType,
            // };
            while (start < ContentLength) {
               const ranges = `bytes=${start}-${end - 1}`;
               const data = await s3
                  .getObject({ ...streamParams, Range: ranges })
                  .promise();
               res.write(data.Body);

               start = end;
               end = Math.min(start + MAX_CHUNK_SIZE, ContentLength);

               if (start < ContentLength) {
                  res.flushHeaders(); // Send the chunk immediately
               }
            }

            res.end();
            //s3.getObject(streamParams).createReadStream().pipe(res);
            //  await pipelineAsync(
            //    s3.getObject(streamParams).createReadStream(),
            //    res
            //  );
         }
      });
      //console.log("getSize", getSize.ContentLength)
   } catch (error) {
      if (!error.statusCode) {
         error.statusCode = 500;
      }
      next(error);
   }
};

export const watchFilms = async (req, res, next) => {
   try {
   } catch (error) {
      if (!error.statusCode) {
         error.statusCode = 500;
      }
      next(error);
   }
};

export const watchtrailerFilms = async (req, res, next) => {
   try {
   } catch (error) {
      if (!error.statusCode) {
         error.statusCode = 500;
      }
      next(error);
   }
};

//get film by tag
export const getFilmByTag = async (req, res, next) => {
   try {
      const tags = req.query.tags.split(',');

      const getfilms = await filmModels.find({ tags: { $in: tags } }).limit(20);
      res.status(200).json(getfilms);
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

      await isVerifiedAdmin(adminId, res);

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
