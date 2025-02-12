import fs from 'fs';
import prisma from '@/utils/db.mjs';
import { returnError } from '@/utils/returnError.js';
import { deleteFromBucket, uploadToBucket } from '@/services/s3.js';
import ChunkService from '@/services/chunkService.js';
import { UPLOAD_DIR } from '@/services/multer.js';
import { io } from '@/utils/sockets.js';
import {
    transcodeOneAtATimeOld,
    transcodeVideo,
} from '@/services/transcodeVideo.js';
import fsExtra from 'fs-extra';
import path from 'path';

const chunkService = new ChunkService();

// utils
/**
 * @name formatFileSize
 * @description function to format file size
 * @param {number} size
 * @returns {"B" | "KB" | "MB" | "GB"}
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
 * @name broadcastProgress
 * @description function to broadcast upload progress to all clients
 * @param {number} progress
 * @returns {void}
 */
function broadcastProgress({ progress, clientId, content }) {
    console.log(`Progress: ${progress}%`);
    io.to(clientId).emit('uploadProgress', { content, progress });
}

//Films
/**
 *
 * @name getFilms
 * @description Get all films
 * @type {import('express').RequestHandler}
 */
export const getFilms = async (_, res, next) => {
    try {
        const films = await prisma.film.findMany({
            select: {
                id: true,
                title: true,
                releaseDate: true,
                type: true,
                genre: true,
                yearOfProduction: true,
                createdAt: true,
                featured: true,
            },
        });

        // films count
        const filmsCount = films.length;

        // groupby count by type
        const filmTypes = films.reduce(
            (acc, film) => {
                if (film.type === 'movie') {
                    acc.movies += 1;
                } else {
                    acc.series += 1;
                }
                return acc;
            },
            { movies: 0, series: 0 }
        );

        return res.status(200).json({ films, filmsCount, filmTypes });
    } catch (error) {
        if (!error.statusCode) {
            error.statusCode = 500;
        }
        next(error);
    }
};

/**
 *
 * @name getFilm
 * @description Get a film by id
 * @type {import('express').RequestHandler}
 */
export const getFilm = async (req, res, next) => {
    try {
        const { filmId } = req.params;
        const film = await prisma.film.findUnique({
            where: {
                id: filmId,
            },
            include: {
                posters: true,
                video: true,
                views: true,
                pricing: {
                    include: { priceList: true },
                },
                purchase: { include: { transaction: true } },
                season: {
                    include: {
                        purchase: true,
                        trailers: true,
                        posters: true,
                        episodes: {
                            include: {
                                video: true,
                                posters: true,
                            },
                        },
                        pricing: {
                            include: { priceList: true },
                        },
                    },
                },
                donation: {
                    include: {
                        transaction: true,
                    },
                },
            },
        });

        if (!film) returnError('Film not found', 404);
        // get the total donation amount for the film
        let totalDonation = 0;

        if (film?.donation.length > 0) {
            totalDonation = film.donation.reduce((acc, donation) => {
                if (donation.transaction.status === 'SUCCESS') {
                    acc += donation.transaction.amount;
                }
                return acc;
            }, 0);
        }

        let purchaseAmount = {};
        // if (film?.access === 'rent') {
        //     // get the total purchase per video resolution
        //     purchaseAmount = film.purchase.reduce((acc, purchase) => {
        //         if (purchase.status === 'SUCCESS') {
        //             if (acc[purchase.resolutions]) {
        //                 acc[purchase.video.resolution] +=
        //                     purchase.transaction.amount;
        //             } else {
        //                 acc[purchase.video.resolution] =
        //                     purchase.transaction.amount;
        //             }
        //         } else {
        //             if (acc[purchase.video.resolution]) {
        //                 acc[purchase.video.resolution] -=
        //                     purchase.transaction.amount;
        //             } else {
        //                 acc[purchase.video.resolution] =
        //                     -purchase.transaction.amount;
        //             }
        //         }
        //         // if (video.purchase.length > 0) {
        //         //     for (let purchase of video.purchase) {
        //         //         if (purchase.transaction.status === 'SUCCESS') {
        //         //             if (acc[video.resolution]) {
        //         //                 acc[video.resolution] +=
        //         //                     purchase.transaction.amount;
        //         //             } else {
        //         //                 acc[video.resolution] =
        //         //                     purchase.transaction.amount;
        //         //             }
        //         //         }
        //         //     }
        //         // }
        //         return acc;
        //     }, {});
        // }

        return res.status(200).json({ film, totalDonation, purchaseAmount });
    } catch (error) {
        if (!error.statusCode) {
            error.statusCode = 500;
        }
        next(error);
    }
};

/**
 * @name createFilm
 * @description Create a new film
 * @type {import('express').RequestHandler}
 */
export const createFilm = async (req, res, next) => {
    try {
        const newFilm = await prisma.film.create({
            data: {
                ...req.data,
                releaseDate: new Date(req.data.releaseDate),
            },
        });

        res.status(201).json({
            message: `${newFilm.title} added.`,
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
 *
 * @name addPosters
 * @description function to add posters to film
 * @type {import('express').RequestHandler}
 */
export const uploadPoster = async (req, res, next) => {
    try {
        const { filmId } = req.params;
        const { isCover, isBackdrop, type } = req.body;

        if (!filmId) returnError('FilmID is required', 400);

        const film =
            type === 'season'
                ? await prisma.season.findUnique({
                      where: { id: filmId },
                      include: {
                          posters: true,
                      },
                  })
                : await prisma.film.findUnique({
                      where: { id: filmId },
                      include: {
                          posters: true,
                      },
                  });

        if (!film) returnError('Film not found', 404);

        // get the file from the request
        const poster = req.file;
        if (!poster) returnError('No file uploaded', 400);
        const bucketParams = {
            bucketName: filmId,
            key: poster.originalname,
            buffer: poster.buffer,
            contentType: poster.mimetype,
            isPublic: true,
        };

        const data = await uploadToBucket(bucketParams, (progress) => {
            broadcastProgress({
                progress,
                clientId: filmId,
                content: { type: 'poster' },
            });
        });

        if (!data.url) returnError('Error uploading file. Try again!', 500);

        const posterData =
            type === 'season'
                ? {
                      url: data.url,
                      name: poster.originalname,
                      type: poster.mimetype,
                      isCover: isCover === 'true' ? true : false,
                      isBackdrop: isBackdrop === 'true' ? true : false,
                      seasonId: filmId,
                  }
                : {
                      url: data.url,
                      name: poster.originalname,
                      type: poster.mimetype,
                      isCover: isCover === 'true' ? true : false,
                      isBackdrop: isBackdrop === 'true' ? true : false,
                      filmId,
                  };

        await prisma.poster.create({ data: posterData });

        res.status(200).json({ message: 'Upload complete' });
    } catch (error) {
        if (!error.statusCode) {
            error.statusCode = 500;
        }
        next(error);
    }
};

// Seasons

/**
 * @name createSeason
 * @description Create a new season for a series
 * @type {import('express').RequestHandler}
 */
export const createSeason = async (req, res, next) => {
    try {
        const { filmId } = req.params;

        // find the film
        const film = await prisma.film.findUnique({
            where: {
                id: filmId,
            },
        });

        if (!film) returnError('Film not found', 404);
        if (film.type !== 'series') returnError('Film is not a series', 400);

        const newSeason = await prisma.season.create({
            data: {
                filmId,
                ...req.data,
            },
        });

        res.status(201).json({
            message: 'New season created',
            season: newSeason,
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
 * @name updateSeason
 * @description Update a season
 * @type {import('express').RequestHandler}
 */
export const updateSeason = async (req, res, next) => {
    try {
        const { seasonId } = req.params;

        if (!seasonId) returnError('Season ID is required', 400);

        // find out if season exists
        const season = await prisma.season.findUnique({
            where: { id: seasonId },
        });

        if (!season) returnError('Season not found', 404);

        const update = await prisma.season.update({
            where: { id: seasonId },
            data: { ...req.data },
        });

        res.status(201).json({
            message: 'Season info updated',
            update,
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
 * @name deleteSeason
 * @description Delete a season
 * @type {import('express').RequestHandler}
 */
export const deleteSeason = async (req, res, next) => {
    try {
        const { seasonId } = req.params;

        const season = await prisma.season.findUnique({
            where: { id: seasonId },
            include: {
                episodes: {
                    include: {
                        video: {
                            select: {
                                name: true,
                            },
                        },
                        poster: true,
                    },
                },
                film: true,
            },
        });

        if (!season) returnError('Season not found', 404);

        // series bucket name: filmId/seasonId/<vidoename>
        if (season.episodes.length > 0) {
            for (let episode of season.episodes) {
                if (episode.video.length > 0) {
                    for (let video of episode.video) {
                        await deleteFromBucket({
                            bucketName: `${season.filmId}-${seasonId}`,
                            key: video.name,
                        });
                    }
                }

                // delete posters
                if (episode.poster.length > 0) {
                    for (let poster of episode.poster) {
                        await deleteFromBucket({
                            bucketName: `${season.filmId}-${seasonId}`,
                            key: poster.name,
                        });
                    }
                }
            }
        }

        await prisma.season.delete({
            where: { id: season.id },
        });

        res.status(200).json({
            season,
            message: 'Season deleted',
        });
    } catch (error) {
        if (!error.statusCode) {
            error.statusCode = 500;
        }
        next(error);
    }
};

// Episodes

/**
 * @name createEpisode
 * @description Create a new episode for a season
 * @type {import('express').RequestHandler}
 */
export const createEpisode = async (req, res, next) => {
    try {
        const { seasonId } = req.params;

        // find the season
        const season = await prisma.season.findUnique({
            where: {
                id: seasonId,
            },
        });

        if (!season) returnError('Season not found', 404);

        const newEpisode = await prisma.episode.create({
            data: {
                seasonId,
                ...req.data,
                releaseDate: new Date(req.data.releaseDate),
            },
        });

        res.status(201).json({
            message: 'New episode created',
            episode: newEpisode,
        });
    } catch (error) {
        if (!error.statusCode) {
            error.statusCode = 500;
        }
        next(error);
    }
};

/**
 *
 * @name addPosters
 * @description function to add posters to film
 * @type {import('express').RequestHandler}
 */
export const uploadEpisodePoster = async (req, res, next) => {
    try {
        const { episodeId } = req.params;
        const { isCover, isBackdrop } = req.body;

        if (!episodeId) returnError('No episode selected', 400);

        const episode = await prisma.episode.findUnique({
            where: { id: episodeId },
            include: {
                season: {
                    include: {
                        film: true,
                    },
                },
            },
        });

        if (!episode) returnError('Episode not found', 404);

        // get the file from the request
        const poster = req.file;
        if (!poster) returnError('No file uploaded', 400);

        // bucket name: filmid-seasonid/<postername>
        const bucketParams = {
            bucketName: `${episode.season.filmId}-${episode.seasonId}`,
            key: poster.originalname,
            buffer: poster.buffer,
            contentType: poster.mimetype,
            isPublic: true,
        };

        const data = await uploadToBucket(bucketParams, (progress) => {
            broadcastProgress({
                progress,
                clientId: episode.id,
                content: { type: 'poster' },
            });
        });

        if (!data.url) returnError('Error uploading file. Try again!', 500);

        const posterData = {
            url: data.url,
            name: poster.originalname,
            type: poster.mimetype,
            isCover: isCover === 'true' ? true : false,
            isBackdrop: isBackdrop === 'true' ? true : false,
            episodeId,
        };

        await prisma.poster.create({
            data: posterData,
        });

        res.status(200).json({ message: 'Upload complete' });
    } catch (error) {
        if (!error.statusCode) {
            error.statusCode = 500;
        }
        next(error);
    }
};

/**
 * @name updateEpisode
 * @description Create a new episode for a season
 * @type {import('express').RequestHandler}
 */
export const updateEpisode = async (req, res, next) => {
    try {
        const { episodeId } = req.params;

        const update = await prisma.episode.update({
            where: {
                id: episodeId,
            },
            data: { ...req.data },
        });

        res.status(201).json({
            message: 'Episode info updated',
            update,
        });
    } catch (error) {
        if (!error.statusCode) {
            error.statusCode = 500;
        }
        next(error);
    }
};

/**
 * @name deleteEpisode
 * @description Delete an episode
 * @type {import('express').RequestHandler}
 */
export const deleteEpisode = async (req, res, next) => {
    try {
        const { episodeId } = req.params;

        const episode = await prisma.episode.findUnique({
            where: {
                id: episodeId,
            },
            include: {
                video: true,
                season: {
                    include: {
                        film: true,
                    },
                },
                poster: true,
            },
        });

        if (!episode) returnError('Episode not found', 404);

        // series bucket name: filmId/seasonId/<vidoename>

        if (episode.video.length > 0) {
            for (let video of episode.video) {
                await deleteFromBucket({
                    bucketName: `${episode?.season.filmId}-${episode.seasonId}`,
                    key: video.name,
                });
            }
        }

        // delete posters
        if (episode.poster.length > 0) {
            for (let poster of episode.poster) {
                await deleteFromBucket({
                    bucketName: `${episode.season.filmId}-${episode.seasonId}`,
                    key: poster.name,
                });
            }
        }

        await prisma.episode.delete({
            where: { id: episodeId },
        });

        res.status(200).json({
            episode,
            message: 'Episode deleted',
        });
    } catch (error) {
        if (!error.statusCode) {
            error.statusCode = 500;
        }
        next(error);
    }
};

/**
 * @name updateFilm
 * @description Update a film by id
 * @type {import('express').RequestHandler}
 */
export const updateFilm = async (req, res, next) => {
    try {
        // check if film exists
        const { filmId } = req.params;
        let update = req.data;

        const film = await prisma.film.findUnique({
            where: {
                id: filmId,
            },
        });

        if (!film) returnError('Film not found', 404);

        if (update.releaseDate) {
            update.releaseDate = new Date(update.releaseDate);
        }

        await prisma.film.update({
            where: { id: filmId },
            data: {
                ...update,
                // updatedAt: new Date(),
            },
        });

        res.status(200).json({ message: 'Film updated successfully' });
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

        const film = await prisma.film.findUnique({
            where: { id: filmId },
            include: {
                video: true,
                posters: true,
            },
        });

        // delete videos
        if (film?.video && film.video.length > 0) {
            for (let video of film.video) {
                await deleteFromBucket({ bucketName: filmId, key: video.name });
            }
        }

        // delete posters
        if (film?.posters && film.posters.length > 0) {
            for (let poster of film.posters) {
                await deleteFromBucket({
                    bucketName: filmId,
                    key: poster.name,
                });
            }
        }

        await prisma.film.delete({
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
        next(error);
    }
};

// Joshua's video upload test.
/**
 *
 * @name uploadingChunks
 * @name Joshua's function to upload chunks
 *  @name combiningChunks
 */
export const uploadingChunks = async (req, res, next) => {
    try {
        const { start, fileName } = req.body;
        // let filesname = fileName.split('.').shift().replace(/\s/g, '_');
        // const chunkPath = path.join(UPLOAD_DIR, `${fileName}-${start}`);
        const chunkPath = path.join(UPLOAD_DIR, `${fileName}-${start}`);

        fs.rename(req.file.path, chunkPath, (err) => {
            if (err) {
                console.error('Error saving chunk:', err);
                return res.status(500).json({ error: 'Error saving chunk' });
            }

            res.status(200).json({ success: true });
        });
    } catch (error) {
        if (!error.statusCode) {
            error.statusCode = 500;
        }
        next(error);
    }
};

/**
 *
 * @name checkingChunks
 * @name Joshua's function to CHECK if a chunk exists
 *  @name checkingChunks
 */
export const checkingChunks = async (req, res, next) => {
    try {
        const { fileName, start } = req.query;

        if (!fileName || !start) {
            return res
                .status(400)
                .json({ exists: false, error: 'Missing fileName or start' });
        }
        // let filesname = fileName.split('.').shift().replace(/\s/g, '_');
        const chunkPath = path.join(UPLOAD_DIR, `${fileName}-${start}`);
        const exists = fs.existsSync(chunkPath);
        return res.json({ exists });
    } catch (error) {
        if (!error.statusCode) {
            error.statusCode = 500;
        }
        next(error);
    }
};

/**
 *
 * @name combiningChunks
 * @name Joshua's function to combine chunks
 *  @name combiningChunks
 */

export const combiningChunks = async (req, res, next) => {
    try {
        const { fileName } = req.body;
        // let filesname = fileName.split('.').shift().replace(/\s/g, '_');

        const filePath = path.join(UPLOAD_DIR, fileName);
        const chunkFiles = fs
            .readdirSync(UPLOAD_DIR)
            .filter((file) => file.startsWith(fileName) && file !== fileName)
            .sort((a, b) => {
                const startA = parseInt(a.split('-').pop());
                const startB = parseInt(b.split('-').pop());
                return startA - startB;
            });

        const finalStream = fs.createWriteStream(filePath);

        for (const chunkFile of chunkFiles) {
            const chunkPath = path.join(UPLOAD_DIR, chunkFile);
            await new Promise((resolve, reject) => {
                const readStream = fs.createReadStream(chunkPath);
                readStream.pipe(finalStream, { end: false }); // Pipe without closing final stream
                readStream.on('end', () => {
                    fs.unlink(chunkPath, (err) => {
                        if (err)
                            console.error(
                                `Error deleting chunk ${chunkFile}:`,
                                err
                            );
                    });
                    resolve();
                });
                readStream.on('error', reject);
            });
        }

        // Close the finalStream properly
        finalStream.end();

        finalStream.on('finish', async () => {
            console.log('File merge complete:', filePath);

            try {
                await fsExtra.promises.access(filePath, fs.constants.R_OK);
                res.status(200).json({
                    success: true,
                    message: 'Chunks combined successfully!',
                });
            } catch (err) {
                console.error('Error accessing merged file:', err);
                res.status(500).json({
                    error: 'Merged file is not accessible',
                });
            }
        });

        finalStream.on('error', (err) => {
            console.error('Error writing final file:', err);
            res.status(500).json({ error: 'Error merging chunks' });
        });
    } catch (error) {
        if (!error.statusCode) {
            error.statusCode = 500;
        }
        next(error);
    }
};

/**
 *
 * @name uploadingFilm
 * @name Joshua's function to combine chunks
 *  @name uploadingFilm
 */

export const uploadingFilm = async (req, res, next) => {
    try {
        const { clientId, fileName, type, resourceId } = req.body;

        if (!clientId) returnError('Client ID is required', 400);
        if (!fileName) returnError('File name is required', 400);
        if (!resourceId) {
            returnError('Either Film ID or EpisodeID is required', 400);
        }

        const filePath = path.join(UPLOAD_DIR, fileName);

        let resource = null;

        if (type === 'film') {
            resource = await prisma.film.findUnique({
                where: { id: resourceId },
            });
        }

        if (type === 'episode') {
            resource = await prisma.episode.findUnique({
                where: { id: resourceId },
                include: {
                    season: { select: { id: true, filmId: true } },
                },
            });
        }

        if (!resource.id) {
            // if resource is not found clear the file from the temp folder
            fs.unlinkSync(filePath);
            returnError("The resource you were looking for doesn't exist", 404);
        }

        const transcoded = await transcodeOneAtATimeOld(
            filePath,
            fileName,
            UPLOAD_DIR,
            clientId,
            {
                resourceId: resourceId,
                type: type,
                resource: resource,
            }
        );

        // const transcoded = await transcodeOneAtATime(
        //     filePath,
        //     fileName,
        //     UPLOAD_DIR,
        //     clientId,
        //     {
        //         resourceId: resourceId,
        //         type: type,
        //         resource: resource,
        //     }
        // );

        res.status(200).json({ message: 'Upload complete' });
    } catch (error) {
        if (!error.statusCode) {
            error.statusCode = 500;
        }
        next(error);
    }
};

/**
 * @name uploadingTrailer
 * @name Joshua's function to upload trailer
 */
export const uploadingTrailer = async (req, res, next) => {
    try {
        const { fileName, clientId, resourceId, type } = req.body;

        console.log('body', req.body);

        if (!resourceId) {
            returnError('Resource ID is required', 400);
        }

        if (!type) {
            returnError('Either type "film" or "season" is required', 400);
        }

        let resource = null;

        if (type === 'film') {
            resource = await prisma.film.findUnique({
                where: { id: resourceId },
            });
        }

        if (type === 'season') {
            resource = await prisma.season.findUnique({
                where: { id: resourceId },
            });
        }

        // const filePath = await chunkService.combineChunks(fileName);
        const filePath = path.join(UPLOAD_DIR, fileName);

        if (!resource) {
            // if resource is not found clear the file from the temp folder
            fs.unlinkSync(filePath);
            returnError('Film or episode was not found', 404);
        }

        // const formattedFilename = chunkService.formatFileName(fileName);

        // check if we have a video with the same name in the bucket
        const videoExists = await prisma.video.findFirst({
            where: { name: fileName },
        });

        if (videoExists) {
            fs.unlinkSync(filePath);
            returnError('A video with the same name already exists', 400);
        }

        const bucketParams = {
            bucketName:
                type === 'film'
                    ? resourceId
                    : `${resource.filmId}-${resource.id}`,
            key: fileName,
            buffer: fs.createReadStream(filePath),
            contentType: 'video/mp4',
            isPublic: true,
        };

        const data = await uploadToBucket(bucketParams, (progress) => {
            broadcastProgress({
                progress,
                clientId,
                content: {
                    type: 'trailer',
                },
            });
        });

        if (data.url) {
            // create video record
            const videoData = {
                url: data.url,
                format: 'video/mp4',
                name: fileName,
                size: formatFileSize(fs.statSync(filePath).size),
                encoding: 'libx264',
                isTrailer: true,
            };

            if (type === 'film') {
                videoData.filmId = resourceId;
            } else {
                videoData.seasonId = resourceId;
            }

            await prisma.video.create({
                data: videoData,
            });

            // delete the file from the temp folder
            fs.unlinkSync(filePath);
        } else {
            // unlink the file from the temp folder
            fs.unlinkSync(filePath);
            returnError('Error uploading file. Try again!', 500);
        }

        res.status(200).json({ message: 'Trailer uploaded' });
    } catch (error) {
        if (!error.statusCode) {
            error.statusCode = 500;
        }
        next(error);
    }
};

// Video Uploads
// film (type: movie)
/**
 * @name uploadChunk
 * @description function to upload chunk to temp folder
 * @type {import('express').RequestHandler}
 */
export const uploadChunk = async (req, res, next) => {
    try {
        const { fileName, start } = req.body;
        console.log('fileName', fileName, start);
        if (!fileName || !start) {
            returnError('File name and start are required', 400);
        }

        const chunkExists = chunkService.checkChunk(fileName, start);
        if (chunkExists) {
            returnError('Chunk already exists', 400);
        }

        const filePath = req.file.path;
        const chunkPath = await chunkService.saveChunk(
            filePath,
            fileName,
            start
        );

        res.status(200).json({
            message: 'Chunk uploaded successfully',
            chunkPath,
        });
    } catch (error) {
        if (!error.statusCode) {
            error.statusCode = 500;
        }
        next(error);
    }
};

/**
 * @name checkUploadChunk
 * @description function to check if chunk is uploaded
 * @type {import('express').RequestHandler}
 */
export const checkUploadChunk = async (req, res, next) => {
    try {
        const { fileName, start } = req.query;
        const chunkExists = chunkService.checkChunk(fileName, start);
        res.status(200).json({ exists: chunkExists });
    } catch (error) {
        if (!error.statusCode) {
            error.statusCode = 500;
        }
        next(error);
    }
};

/**
 * @name uploadFilm film to bucket
 * @description function to upload film to bucket and get signed url
 * @type {import('express').RequestHandler}
 */
export const uploadFilm = async (req, res, next) => {
    try {
        const { clientId, fileName, type, resourceId } = req.body; // type: film or episode / resourceId: filmId or episodeId / if type is episode, seasonId is required

        if (!clientId) returnError('Client ID is required', 400);
        if (!fileName) returnError('File name is required', 400);
        if (!resourceId) {
            returnError('Either Film ID or EpisodeID is required', 400);
        }

        // combine the chunks
        const filePath = await chunkService.combineChunks(fileName);

        let resource = null;

        if (type === 'film') {
            resource = await prisma.film.findUnique({
                where: { id: resourceId },
            });
        }

        if (type === 'episode') {
            resource = await prisma.episode.findUnique({
                where: { id: resourceId },
                include: { season: { select: { id: true, filmId: true } } },
            });
        }

        if (!resource) {
            // if resource is not found clear the file from the temp folder
            fs.unlinkSync(filePath);
            returnError("The resource you were looking for doesn't exist", 404);
        }

        const bucketName =
            type === 'film'
                ? resourceId
                : `${resource.season?.filmId}-${resource.seasonId}`;

        const onPreTranscode = async (resolutions) => {
            try {
                let videos = [];

                if (type === 'film') {
                    videos = await prisma.video.findMany({
                        where: { filmId: resourceId, isTrailer: false },
                        select: { id: true, resolution: true },
                    });
                }

                if (type === 'season') {
                    videos = await prisma.video.findMany({
                        where: { seasonId: resourceId, isTrailer: false },
                        select: { id: true, resolution: true },
                    });
                }

                console.log('Videos', JSON.stringify(videos, null, 3));

                // if no videos are found, use the default resolutions
                if (!videos.length > 0) return resolutions;

                const notInVideos = {};
                for (const [resolution, ht] of Object.entries(resolutions)) {
                    const exists = videos.some(
                        (vid) => vid.resolution === resolution
                    );
                    if (!exists) {
                        notInVideos[resolution] = ht;
                    }
                }
                return notInVideos;
            } catch (error) {
                console.log('onPreTranscode', error);
                throw error;
            }
        };

        const onUploadComplete = async (data) => {
            let result = { ...data };

            if (type === 'film') {
                result.filmId = resourceId;
            }
            if (type === 'season') {
                result.seasonId = resourceId;
            }

            await prisma.video.create({
                data: result,
            });

            console.log('Uploaded video:', JSON.stringify(result, null, 3));
        };

        // transcode the video ie generate multiple resolutions of the video
        await transcodeVideo({
            type,
            filePath,
            fileName,
            clientId,
            bucketName,
            onPreTranscode,
            onUploadComplete,
            outputDir: UPLOAD_DIR,
        });

        // for (const result of transcoded) {
        //     // save the details of the video
        //     if (type === 'film') {
        //         result.filmId = resourceId;
        //     }
        //     if (type === 'episode') {
        //         result.episodeId = resourceId;
        //     }

        //     // add the video to the database
        //     await prisma.video.create({
        //         data: result,
        //     });
        // }

        res.status(200).json({ message: 'Upload complete' });
    } catch (error) {
        if (!error.statusCode) {
            error.statusCode = 500;
        }

        next(error);
    }
};

/**
 * @name uploadTrailer
 * @description function to upload film trailer to bucket
 * @type {import('express').RequestHandler}
 */
export const uploadTrailer = async (req, res, next) => {
    try {
        const { fileName, clientId, resourceId, type } = req.body;

        if (!resourceId) {
            returnError('Resource ID is required', 400);
        }

        if (!type) {
            returnError('Either type "film" or "season" is required', 400);
        }

        let resource = null;

        if (type === 'film') {
            resource = await prisma.film.findUnique({
                where: { id: resourceId },
            });
        }

        if (type === 'season') {
            resource = await prisma.season.findUnique({
                where: { id: resourceId },
            });
        }

        const filePath = await chunkService.combineChunks(fileName);

        if (!resource) {
            // if resource is not found clear the file from the temp folder
            fs.unlinkSync(filePath);
            returnError('Film or episode was not found', 404);
        }

        const { filename } = chunkService.formatFileName(fileName);

        // check if we have a video with the same name in the bucket
        const videoExists = await prisma.video.findFirst({
            where: { name: fileName },
        });

        if (videoExists) {
            fs.unlinkSync(filePath);
            returnError('A video with the same name already exists', 400);
        }

        const bucketParams = {
            bucketName:
                type === 'film'
                    ? resourceId
                    : `${resource.filmId}-${resource.id}`,
            key: filename,
            buffer: fs.createReadStream(filePath),
            contentType: 'video/mp4',
            isPublic: true,
        };

        const data = await uploadToBucket(bucketParams, (progress) => {
            broadcastProgress({
                progress,
                clientId,
                content: {
                    type: 'trailer',
                },
            });
        });

        if (data.url) {
            // create video record
            const videoData = {
                url: data.url,
                format: 'video/mp4',
                name: filename,
                size: formatFileSize(fs.statSync(filePath).size),
                encoding: 'libx264',
                isTrailer: true,
            };

            if (type === 'film') {
                videoData.filmId = resourceId;
            } else {
                videoData.seasonId = resourceId;
            }

            await prisma.video.create({
                data: videoData,
            });

            // delete the file from the temp folder
            await fs.promises.rm(filePath);
        } else {
            // unlink the file from the temp folder
            await fs.promises.rm(filePath);
            returnError('Error uploading file. Try again!', 500);
        }

        res.status(200).json({ message: 'Trailer uploaded' });
    } catch (error) {
        if (!error.statusCode) {
            error.statusCode = 500;
        }
        next(error);
    }
};

/**
 *
 * @name getDonations
 * @description Get all donations {appDonations, webDonations}
 * @type {import('express').RequestHandler}
 */
export const getDonations = async (req, res, next) => {
    try {
        const appDonations = await prisma.donation.findMany({
            where: { status: 'SUCCESS' },
        });
        const webDonations = await prisma.webDonation.findMany({
            where: { payment_status_description: 'Transaction Successful' },
        });

        return res.status(200).json({
            appDonations,
            webDonations,
        });
    } catch (error) {
        if (!error.statusCode) {
            error.statusCode = 500;
        }
        next(error);
    }
};

/**
 * @name getPurchaseHistory
 * @description function to delete a video
 * @type {import('express').RequestHandler}
 */
export const getPurchaseHistory = async (req, res, next) => {
    try {
        const transactions = await prisma.transaction.findMany({
            where: {
                type: 'PURCHASE',
                status: { in: ['SUCCESS', 'PENDING'] },
            },
            include: {
                user: {
                    select: {
                        id: true,
                        firstname: true,
                        lastname: true,
                        email: true,
                    },
                },
            },
        });

        const totalAmount = transactions.reduce((acc, transaction) => {
            acc += parseFloat(transaction.amount);
            return acc;
        }, 0);

        return res.status(200).json({ transactions, totalAmount });
    } catch (error) {
        if (!error.statusCode) {
            error.statusCode = 500;
        }
        next(error);
    }
};

/**
 * @name deletePoster
 * @description function to delete a video
 * @type {import('express').RequestHandler}
 */
export const deletePoster = async (req, res, next) => {
    try {
        const { posterId } = req.params;

        const poster = await prisma.poster.findUnique({
            where: { id: posterId },
            include: {
                film: true,
                episode: {
                    include: {
                        season: true,
                    },
                },
            },
        });

        if (!poster) returnError('Poster not found', 404);

        if (poster.film) {
            await deleteFromBucket({
                key: poster.name,
                bucketName: poster.film.id,
            });
        }

        if (poster.episode) {
            await deleteFromBucket({
                key: poster.name,
                bucketName: `${poster.episode.season.filmId}-${poster.episode.seasonId}`,
            });
        }

        await prisma.poster.delete({
            where: { id: posterId },
        });

        return res.status(200).json({ message: 'Poster deleted' });
    } catch (error) {
        if (!error.statusCode) {
            error.statusCode = 500;
        }
        next(error);
    }
};

/**
 * @name deleteVideo
 * @description function to delete a video
 * @type {import('express').RequestHandler}
 */
export const deleteVideo = async (req, res, next) => {
    try {
        const { videoId } = req.params;

        const video = await prisma.video.findUnique({
            where: { id: videoId },
            include: {
                film: true,
                episode: {
                    select: {
                        id: true,
                        seasonId: true,
                    },
                },
            },
        });

        if (!video) returnError('Video not found', 404);

        if (video.film) {
            await deleteFromBucket({
                key: video.name,
                bucketName: video.film.id,
            });
        }

        if (video.episode) {
            await deleteFromBucket({
                key: video.name,
                bucketName: `${video.filmId}-${video.episode.seasonId}`,
            });
        }

        await prisma.video.delete({
            where: { id: videoId },
        });

        return res.status(200).json({ message: 'Video deleted' });
    } catch (error) {
        if (!error.statusCode) {
            error.statusCode = 500;
        }
        next(error);
    }
};

// Categories
/**
 * @name getCategories
 * @description function to get all categories
 * @type {import('express').RequestHandler}
 */
export const getCategories = async (_, res, next) => {
    try {
        const categories = await prisma.category.findMany({
            include: {
                films: { include: { posters: true } },
                seasons: {
                    include: {
                        film: true,
                        posters: true,
                    },
                },
            },
        });
        return res.status(200).json({ categories: categories ?? [] });
    } catch (error) {
        if (!error.statusCode) {
            error.statusCode = 500;
        }
        next(error);
    }
};

/**
 * @name getCategory
 * @description  function to get a category
 * @type {import('express').RequestHandler}
 */
export const getCategory = async (req, res, next) => {
    try {
        const { categoryId } = req.params;

        if (!categoryId) returnError('Category ID is required', 400);

        const category = await prisma.category.findUnique({
            where: { id: categoryId },
            include: {
                films: {
                    include: {
                        posters: true,
                        views: true,
                    },
                },
                seasons: {
                    include: {
                        film: true,
                        posters: true,
                        trailers: true,
                    },
                },
            },
        });

        if (!category) res.status(200).json({ category: null });

        return res.status(200).json({ category });
    } catch (error) {
        if (!error.statusCode) {
            error.statusCode = 500;
        }
        next(error);
    }
};

/**
 * @name createCategory
 * @description function to create a category
 * @type {import('express').RequestHandler}
 */

export const createCategory = async (req, res, next) => {
    const { name, type, films, genre, seasons } = req.data; // name, type, film[], genre[], seasons[]

    // types: mixed, films, series, genre
    if (!name || !type) returnError('Name and type are required', 400);

    // initialize category
    let category = await prisma.category.create({
        data: { name, type },
        include: {
            films: {
                include: {
                    video: { where: { isTrailer: true } },
                    posters: true,
                },
            },
            seasons: {
                include: {
                    posters: true,
                    trailers: true,
                    episodes: {
                        include: {
                            video: { where: { isTrailer: true } },
                            posters: true,
                        },
                    },
                },
            },
        },
    });

    try {
        switch (type) {
            case 'mixed':
            case 'films':
                // we need the filmslist with the ids of the selected films
                if (films.length > 0) {
                    for (let filmId of films) {
                        await prisma.category.update({
                            where: { id: category.id },
                            data: { films: { connect: { id: filmId } } },
                        });
                    }
                }
                break;
            case 'series':
                if (seasons.length > 0) {
                    for (let seasonId of seasons) {
                        // update category with season
                        await prisma.category.update({
                            where: { id: category.id },
                            data: { seasons: { connect: { id: seasonId } } },
                        });
                    }
                }
                break;
            case 'genre':
                const filmIds = await prisma.film.findMany({
                    where: { genre: { hasSome: genre } },
                    select: { id: true },
                    take: 10,
                });

                if (filmIds.length > 0) {
                    for (let filmId of filmIds) {
                        await prisma.category.update({
                            where: { id: category.id },
                            data: { films: { connect: { id: filmId.id } } },
                        });
                    }
                }
                break;
        }

        res.status(201).json({
            message: 'Category created successfully',
        });
    } catch (error) {
        if (!error.statusCode) {
            error.statusCode = 500;
        }
        next(error);
    }
};

/**
 * @name addFilmToCategory
 * @description function to connect or disconnect a category to a film
 * @type {import('express').RequestHandler}
 */
export const addFilmToCategory = async (req, res, next) => {
    try {
        const { categoryId } = req.params;
        const { type, films, genre, seasons } = req.data;

        if (!categoryId) returnError('Category ID is required', 400);

        const category = await prisma.category.findUnique({
            where: { id: categoryId },
            include: { films: { select: { id: true } } },
        });

        if (!category) returnError('Category not found', 404);

        switch (type) {
            case 'films':
            case 'mixed':
                if (films.length > 0) {
                    for (let filmId of films) {
                        await prisma.category.update({
                            where: { id: category.id },
                            data: { films: { connect: { id: filmId } } },
                        });
                    }
                }
                break;
            case 'series':
                if (seasons.length > 0) {
                    for (let seasonId of seasons) {
                        // update category with season
                        await prisma.category.update({
                            where: { id: category.id },
                            data: { seasons: { connect: { id: seasonId } } },
                        });
                    }
                }
                break;
            case 'genre':
                const filmIds = await prisma.film.findMany({
                    where: { genre: { hasSome: genre } },
                    select: { id: true },
                    take: 10,
                });

                // filter films that are already in the category
                const filmsToAdd = filmIds.filter(
                    (film) => !category.films.some((f) => f.id === film.id)
                );

                if (filmsToAdd.length > 0) {
                    for (let filmId of filmsToAdd) {
                        await prisma.category.update({
                            where: { id: category.id },
                            data: { films: { connect: { id: filmId.id } } },
                        });
                    }
                }

                break;
            default:
                returnError('Invalid type', 400);
        }

        res.status(200).json({
            message: 'Film added to category successfully',
        });
    } catch (error) {
        if (!error.statusCode) {
            error.statusCode = 500;
        }
        next(error);
    }
};

/**
 * @name removeFilmFromCategory
 * @description function to connect or disconnect a category to a film
 * @type {import('express').RequestHandler}
 */
export const removeFilmFromCategory = async (req, res, next) => {
    try {
        const { categoryId } = req.params;
        const { type, films, seasons } = req.data;

        if (!categoryId) returnError('Category ID is required', 400);

        const category = await prisma.category.findUnique({
            where: { id: categoryId },
        });

        if (!category) returnError('Category not found', 404);

        switch (type) {
            case 'films':
            case 'mixed':
            case 'genre':
                if (films.length > 0) {
                    for (let filmId of films) {
                        await prisma.category.update({
                            where: { id: category.id },
                            data: { films: { disconnect: { id: filmId } } },
                        });
                    }
                }
                break;
            case 'series':
                if (seasons.length > 0) {
                    for (let seasonId of seasons) {
                        // update category with season
                        await prisma.category.update({
                            where: { id: category.id },
                            data: { seasons: { disconnect: { id: seasonId } } },
                        });
                    }
                }
                break;
            default:
                returnError('Invalid type', 400);
                break;
        }

        res.status(200).json({ message: 'Removed from category successfully' });
    } catch (error) {
        if (!error.statusCode) {
            error.statusCode = 500;
        }
        next(error);
    }
};

/**
 * @name updateCategory
 * @description function to update a category
 * @type {import('express').RequestHandler}
 */
export const updateCategory = async (req, res, next) => {
    try {
        const { categoryId } = req.params;

        if (!categoryId) returnError('Category ID is required', 400);

        await prisma.category.update({
            where: { id: categoryId },
            data: {
                name: req.data.name,
            },
        });

        res.status(200).json({
            message: 'Category updated successfully',
        });
    } catch (error) {
        if (!error.statusCode) {
            error.statusCode = 500;
        }
        next(error);
    }
};

/**
 * @name deleteCategory
 * @description function to delete a category
 * @type {import('express').RequestHandler}
 */
export const deleteCategory = async (req, res, next) => {
    try {
        const { categoryId } = req.params;

        if (!categoryId) returnError('Category ID is required', 400);

        const category = await prisma.category.findUnique({
            where: { id: categoryId },
        });

        if (!category) returnError('Category not found', 404);

        await prisma.category.delete({
            where: { id: categoryId },
        });

        res.status(200).json({
            message: 'Category deleted successfully',
        });
    } catch (error) {
        if (!error.statusCode) {
            error.statusCode = 500;
        }
        next(error);
    }
};

// Handle Pricing

/**
 * @name createPricing
 * @description function to get price by currency and type
 * @type {import('express').RequestHandler}
 */
export const createPricing = async (req, res, next) => {
    try {
        const { type, resourceId, currency, priceList } = req.data; // this is validated data: type (movie, season)
        const resourceField = type === 'movie' ? 'filmId' : 'seasonId';

        let resource = null;
        switch (type) {
            case 'movie':
                resource = await prisma.film.findUnique({
                    where: { id: resourceId },
                });
                if (!resource) returnError('Film not found', 404);
                break;
            case 'season':
                resource = await prisma.season.findUnique({
                    where: { id: resourceId },
                });
                if (!resource) returnError('Season not found', 404);
                break;
            default:
                returnError('Type must be either "movie" or "season"', 400);
                break;
        }

        await prisma.pricing.create({
            data: {
                [resourceField]: resourceId,
                currency,
                priceList: { create: [...priceList] },
            },
        });

        res.status(201).json({ message: 'Prices added successfully' });
    } catch (error) {
        if (!error.statusCode) {
            error.statusCode = 500;
        }

        next(error);
    }
};

/**
 * @name updatePricing
 * @description function to get price by currency and type
 * @type {import('express').RequestHandler}
 */
export const updatePricing = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { currency, priceList } = req.data;

        if (!id) returnError('ID is required', 400);

        const existingPricing = await prisma.pricing.findUnique({
            where: { id },
        });

        if (!existingPricing) returnError('Pricing not found', 404);

        const data = {
            priceList: {
                update: priceList.map((item) => ({
                    where: { id: item.id },
                    data: {
                        price: item.price,
                    },
                })),
            },
        };

        if (currency) {
            data.currency = currency;
        }

        // update pricing
        const updatedPricing = await prisma.pricing.update({
            where: { id },
            data,
        });

        if (!updatedPricing) returnError('Pricing not found', 404);

        res.status(200).json({ message: 'Pricing updated successfully' });
    } catch (error) {
        if (!error.statusCode) {
            error.statusCode = 500;
        }

        next(error);
    }
};

/**
 * @name deleteVideos
 * @description function to get price by currency and type
 * @type {import('express').RequestHandler}
 */
export const deleteVideos = async (req, res, next) => {
    try {
        let { videoIds } = req.data; // videoIds[]
        if (!videoIds?.length) returnError('Video IDs are required', 400);

        // clean up videoIds and removes null values
        videoIds = videoIds.filter(Boolean);

        const videos = await prisma.video.findMany({
            where: { id: { in: videoIds } },
            include: {
                film: { select: { id: true } },
                episode: { select: { id: true, seasonId: true } },
            },
        });

        if (!videos?.length) returnError('Videos not found', 404);

        for (let video of videos) {
            if (!video) continue;

            if (video.film) {
                // means that the video is movie
                await deleteFromBucket({
                    bucketName: video.film.id,
                    key: video.name,
                });
            }

            if (video.episode) {
                // means that the video is an episode
                await deleteFromBucket({
                    bucketName: `${video?.filmId}-${video.episode.seasonId}`,
                    key: video.name,
                });
            }
        }

        // delete videos
        await prisma.video.deleteMany({
            where: { id: { in: videoIds } },
        });

        res.status(200).json({ message: 'Videos deleted successfully' });
    } catch (error) {
        if (!error.statusCode) {
            error.statusCode = 500;
        }

        next(error);
    }
};
