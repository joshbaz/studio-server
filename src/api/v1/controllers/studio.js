import fs from 'fs';
import prisma from '@/utils/db.mjs';
import { returnError } from '@/utils/returnError.js';
import { deleteFromBucket, uploadToBucket } from '@/services/s3.js';
import ChunkService from '@/services/chunkService.js';
import { UPLOAD_DIR } from '@/services/multer.js';
import { io } from '@/utils/sockets.js';
import { Agent as HttpsAgent } from 'https';
import { uploadSubtitleToDO } from '@/services/transcodeVideo.js';
import dotenv from 'dotenv'
dotenv.config();

import fsExtra from 'fs-extra';
import path from 'path';
import { videoQueue, hlsUploadQueue, masterPlaylistQueue } from '@/services/queueWorkers.js';
import { formatNumber } from '@/utils/formatNumber.js';

// Configure HTTPS agent for high concurrency S3 operations
const httpsAgent = new HttpsAgent({
    keepAlive: true,
    keepAliveMsecs: 30000, // 30 seconds
    maxSockets: 500, // Increased from 200 to 500 for very high concurrency
    maxFreeSockets: 100, // Increased from 50 to 100
    timeout: 60000, // 60 seconds
    freeSocketTimeout: 30000, // 30 seconds
    socketAcquisitionWarningTimeout: 10000, // Increased to 10 seconds warning
});

// Shared S3 client configuration for high concurrency
const createS3Client = async () => {
    const { S3Client } = await import('@aws-sdk/client-s3');
    return new S3Client({
        endpoint: process.env.DO_REGIONALSPACESENDPOINT,
        region: process.env.DO_SPACESREGION,
        credentials: {
            accessKeyId: process.env.DO_SPACEACCESSKEY,
            secretAccessKey: process.env.DO_SPACESECRETKEY
        },
        maxAttempts: 3, // Retry failed requests
        retryMode: 'adaptive', // Adaptive retry strategy
        requestHandler: {
            httpOptions: {
                agent: httpsAgent,
                timeout: 60000, // 60 seconds timeout
            }
        }
    });
};

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

/**
 * @name cleanupFilmFolder
 * @description Clean up film folder and chunks for a given resource
 * @param {string} resourceId - The resource ID (film or episode ID)
 * @param {string} type - The type of resource ('film' or 'episode')
 * @param {string} fileName - The original file name
 */
const cleanupFilmFolder = async (resourceId, type, fileName) => {
    try {
        // Clean up chunks folder if it exists
        const chunkService = new ChunkService();
        try {
            await chunkService.deleteChunksFolder(fileName);
        } catch (chunkError) {
            // Ignore errors if chunks folder doesn't exist
            console.log('Chunks folder cleanup skipped:', chunkError.message);
        }

        // Clean up any temporary files in uploads directory
        const { filename } = chunkService.formatFileName(fileName);

        // Clean up the original combined file
        const originalFilePath = path.join(UPLOAD_DIR, `${filename}.mp4`);
        if (fs.existsSync(originalFilePath)) {
            fs.unlinkSync(originalFilePath);
            console.log(`🗑️ Cleaned up original file: ${filename}.mp4`);
        }

        // Clean up final transcoded .mp4 files (SD_, HD_, FHD_, UHD_ prefixed files)
        const transcodedFiles = [
            `SD_${filename}.mp4`,
            `HD_${filename}.mp4`,
            `FHD_${filename}.mp4`,
            `UHD_${filename}.mp4`
        ];

        for (const transcodedFile of transcodedFiles) {
            const transcodedFilePath = path.join(UPLOAD_DIR, transcodedFile);
            if (fs.existsSync(transcodedFilePath)) {
                fs.unlinkSync(transcodedFilePath);
                console.log(`🗑️ Cleaned up transcoded file: ${transcodedFile}`);
            }
        }

        // Clean up segment folders if they exist
        const segmentFolder = path.join(UPLOAD_DIR, `segments_${filename}`);
        if (fs.existsSync(segmentFolder)) {
            fs.rmSync(segmentFolder, { recursive: true, force: true });
            console.log(`🗑️ Cleaned up segment folder: segments_${filename}`);
        }

        console.log(`🧹 Cleaned up folders for ${type} ${resourceId} (${fileName})`);
    } catch (error) {
        console.error('Error cleaning up film folder:', error.message);
        // Don't throw error as this is cleanup operation
    }
};

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
        const { resourceId } = req.params;
        const { isCover, isBackdrop, type } = req.body;

        if (!resourceId) returnError('FilmID is required', 400);

        let resource = null;

        if (type === 'film') {
            resource = await prisma.film.findUnique({
                where: { id: resourceId },
                include: { posters: true },
            });
        }

        if (type === 'season') {
            resource = await prisma.season.findUnique({
                where: { id: resourceId },
                include: { posters: true },
            });
        }

        if (type === 'episode') {
            resource = await prisma.episode.findUnique({
                where: { id: resourceId },
                include: { posters: true },
            });
        }

        if (!resource) returnError('Film, season or episode not found', 404);

        const hasSameName = resource.posters.some(
            (poster) => poster.name === poster.originalname
        );

        if (hasSameName) {
            returnError('You cannot have two images with same name', 409);
        }

        // get the file from the request
        const poster = req.file;
        if (!poster) returnError('No file uploaded', 400);

        const bucketName =
            type === 'film' ? resourceId : `${resource.filmId}-${resourceId}`;

        const bucketParams = {
            bucketName,
            key: poster.originalname,
            buffer: poster.buffer,
            contentType: poster.mimetype,
            isPublic: true,
        };

        const data = await uploadToBucket(bucketParams, (progress) => {
            broadcastProgress({
                progress,
                clientId: resourceId,
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
        };

        if (type === 'film') {
            posterData.filmId = resourceId;
        } else if (type === 'season') {
            posterData.seasonId = resourceId;
        } else {
            posterData.episodeId = resourceId;
        }

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
                        posters: true,
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
                if (episode.posters.length > 0) {
                    for (let poster of episode.posters) {
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

        if (!episodeId) returnError('Episode ID is required selected', 400);

        const episode = await prisma.episode.findUnique({
            where: { id: episodeId },
            include: {
                video: true,
                season: { select: { id: true, filmId: true } },
                posters: true,
            },
        });

        if (!episode) returnError('Episode not found', 404);

        // series bucket name: filmId/seasonId/<vidoename>

        if (episode.video.length > 0) {
            for (let video of episode.video) {
                await deleteFromBucket({
                    bucketName: `${episode.season?.filmId}-${episode.seasonId}`,
                    key: video.name,
                });
            }
        }

        // delete posters
        if (episode.posters.length > 0) {
            for (let poster of episode.posters) {
                await deleteFromBucket({
                    bucketName: `${episode.season.filmId}-${episode.seasonId}`,
                    key: poster.name,
                });
            }
        }

        await prisma.episode.delete({
            where: { id: episodeId },
        });

        res.status(200).json({ message: 'Episode deleted' });
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
        // const exists = fs.existsSync(chunkPath);
        const exists = false;
        console.log("exists", exists)
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


// Video Uploads
// film (type: movie)
/**
 * @name uploadChunk
 * @description function to upload chunk to temp folder
 * @type {import('express').RequestHandler}
 */
export const uploadChunk = async (req, res, next) => {
    const { fileName, start } = req.body;
    try {
        console.log('fileName', fileName, start);
        if (!fileName || !start) {
            returnError('File name and start are required', 400);
        }


        // remove the check chunk service
        // const chunkExists = chunkService.checkChunk(fileName, start);
        // if (chunkExists) {
        //     returnError('Chunk already exists', 400);
        // }

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
        // If there is an error, attempt to delete the chunk folder before sending the error
        if (fileName) {
            try {
                await chunkService.deleteChunksFolder(fileName);
            } catch (cleanupErr) {
                console.error('Error cleaning up chunk folder:', cleanupErr);
            }
        }
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
 * @name uploadFilm2 film to bucket
 * @description function to upload film to bucket and get signed url
 * @type {import('express').RequestHandler}
 */


export const uploadFilm2 = async (req, res, next) => {
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
            await fs.promises.rm(filePath);
            returnError("The resource you were looking for doesn't exist", 404);
        }

        const bucketName =
            type === 'film'
                ? resourceId
                : `${resource.season?.filmId}-${resource.seasonId}`;

        const { filename } = new ChunkService().formatFileName(fileName);

        // Add job to queue
        const job = await videoQueue.add('transcode-video', {
            type,
            filePath,
            resourceId,
            resource,
            fileName,
            filename,
            clientId,
            bucketName,
            outputDir: UPLOAD_DIR,
        });

        // Save job details to database
        const jobData = {
            jobId: job.id.toString(),
            queueName: 'video-transcoding',
            status: 'waiting',

            resourceId,
            resourceType: type,
            resourceName: type === 'film' ? resource.title : resource.title,
            fileName,
            canCancel: true,
        };

        if (type === 'film') {
            jobData.filmId = resourceId;
        } else {
            jobData.episodeId = resourceId;
        }

        await prisma.videoProcessingJob.create({
            data: jobData,
        });

        res.status(200).json({
            message:
                'video upload received. Processing in the background will start shortly.',
            jobQueued: true,
            jobId: job.id.toString(),
        });
    } catch (error) {
        if (!error.statusCode) {
            error.statusCode = 500;
        }

        next(error);
    }
};

/**
 * @name uploadTrailer
 * @description function to upload film trailer to bucket with HLS processing via queue
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
            await fs.promises.unlink(filePath);
            returnError('Film or episode was not found', 404);
        }

        const { filename } = chunkService.formatFileName(fileName);

        // check if we have a video with the same name in the bucket
        const videoExists = await prisma.video.findFirst({
            where: { name: fileName },
        });

        if (videoExists) {
            await fs.promises.rm(filePath);
            returnError('A video with the same name already exists', 400);
        }

        const bucketName = type === 'film' ? resourceId : `${resource.filmId}-${resource.id}`;

        // Create a unique job ID for tracking
        const jobId = `trailer_${resourceId}_${Date.now()}`;

        try {
            // Create a processing job record in the database
            await prisma.videoProcessingJob.create({
                data: {
                    jobId: jobId,
                    resourceId: resourceId,
                    resourceType: type,
                    fileName: filename,
                    filePath: filePath,
                    status: 'waiting',
                    jobType: 'trailer_processing',
                    clientId: clientId,
                    bucketName: bucketName,
                    createdAt: new Date(),
                    updatedAt: new Date()
                }
            });

            // Queue the trailer processing job
            await videoQueue.add('process-trailer-hls', {
                jobId: jobId,
                type: type,
                filePath: filePath,
                resourceId: resourceId,
                resource: resource,
                fileName: fileName,
                filename: filename,
                bucketName: bucketName,
                clientId: clientId
            }, {
                // Queue options
                attempts: 3, // Retry up to 3 times on failure
                backoff: {
                    type: 'exponential',
                    delay: 5000, // Start with 5 second delay
                },
                removeOnComplete: 10, // Keep last 10 completed jobs
                removeOnFail: 5, // Keep last 5 failed jobs
            });

            console.log(`✅ Trailer processing job queued: ${jobId}`);

            // Update job status to processing
            await prisma.videoProcessingJob.update({
                where: { jobId: jobId },
                data: {
                    status: 'processing',
                    updatedAt: new Date()
                }
            });

            // Send immediate response that job is queued
            broadcastProgress({
                progress: 0,
                clientId,
                content: {
                    type: 'trailer_processing',
                    stage: 'queued',
                    jobId: jobId
                },
            });

        } catch (queueError) {
            console.error('❌ Trailer queue processing failed:', queueError);

            // Clean up files on queue error
            try {
                await fs.promises.rm(filePath);
            } catch (cleanupError) {
                console.error('❌ Error cleaning up file:', cleanupError);
            }

            // Clean up job record if it was created
            try {
                await prisma.videoProcessingJob.deleteMany({
                    where: { jobId: jobId }
                });
            } catch (dbError) {
                console.error('❌ Error cleaning up job record:', dbError);
            }

            returnError('Error queuing trailer processing. Try again!', 500);
        }

        res.status(200).json({
            message: 'Trailer processing job queued successfully',
            jobId: jobId,
            status: 'queued'
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
 * @name getDonations
 * @description Get all donations {appDonations, webDonations}
 * @type {import('express').RequestHandler}
 */
export const getDonations = async (req, res, next) => {
    try {
        const appDonations =
            (await prisma.donation.findMany({
                where: { status: 'SUCCESS' },
                include: {
                    transaction: {
                        select: {
                            amount: true,
                            type: true,
                            status: true,
                        },
                    },
                },
            })) ?? [];
        const webDonations =
            (await prisma.webDonation.findMany({
                where: { payment_status_description: 'Transaction Successful' },
            })) ?? [];

        const totalAppDonations = appDonations.reduce((acc, donation) => {
            acc += donation.transaction.amount;
            return acc;
        }, 0);

        const totalWebDonations = webDonations.reduce((acc, donation) => {
            acc += donation.amount;
            return acc;
        }, 0);

        return res.status(200).json({
            appDonations,
            webDonations,
            totalAppDonations: formatNumber(totalAppDonations),
            totalWebDonations: formatNumber(totalWebDonations),
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
                purchase: {
                    include: { film: true, season: true },
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
                season: {
                    select: {
                        id: true,
                        filmId: true,
                    },
                },
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
            // Extract base video name for HLS file deletion
            const baseVideoName = video.name.replace(/\.(m3u8|mp4)$/, ''); // Remove extension
            const cleanBaseName = baseVideoName.replace(/^(SD_|HD_|FHD_|UHD_|master_)/, ''); // Remove resolution and master prefixes

            // means that the video is movie
            const resourceId = video.film.id;
            console.log(`🎬 Deleting film video: ${video.name} from bucket: ${resourceId}`);

            // Enhanced folder-based deletion for HLS and subtitle files
            const foldersToDelete = [
                // HLS folders for each resolution
                `${resourceId}/hls_trailer`,

            ];
            // Delete entire folders from DigitalOcean Spaces
            console.log(`🗑️ Deleting ${foldersToDelete.length} folders from DigitalOcean Spaces...`);
            for (const folder of foldersToDelete) {
                try {
                    // List all objects in the folder
                    const { ListObjectsV2Command, DeleteObjectsCommand } = await import('@aws-sdk/client-s3');
                    const s3Client = await createS3Client();

                    // List all objects in the folder
                    const listCommand = new ListObjectsV2Command({
                        Bucket: process.env.DO_SPACESBUCKET,
                        Prefix: folder,
                    });

                    const listResponse = await s3Client.send(listCommand);

                    if (listResponse.Contents && listResponse.Contents.length > 0) {
                        // Delete all objects in the folder
                        const deleteCommand = new DeleteObjectsCommand({
                            Bucket: process.env.DO_SPACESBUCKET,
                            Delete: {
                                Objects: listResponse.Contents.map(obj => ({ Key: obj.Key })),
                                Quiet: false
                            }
                        });

                        const deleteResponse = await s3Client.send(deleteCommand);
                        console.log(`🗑️ Deleted folder: ${folder} (${listResponse.Contents.length} files)`);

                        if (deleteResponse.Errors && deleteResponse.Errors.length > 0) {
                            console.warn(`⚠️ Some files in ${folder} could not be deleted:`, deleteResponse.Errors);
                        }
                    } else {
                        console.log(`📁 Folder ${folder} is empty or doesn't exist`);
                    }
                } catch (error) {
                    console.error(`❌ Error deleting folder ${folder}:`, error.message);
                }
            }


        }

        if (video?.season){
             // means that the video is an episode
             const resourceId = `${video.season.filmId}-${video.season.id}`;
             console.log(`🎬 Deleting episode video: ${video.name} from bucket: ${resourceId}`);

             // Enhanced folder-based deletion for HLS and subtitle files
             const foldersToDelete = [
                // HLS folders for each resolution
                `${resourceId}/hls_trailer`,

            ];

                // Delete entire folders from DigitalOcean Spaces
                console.log(`🗑️ Deleting ${foldersToDelete.length} folders from DigitalOcean Spaces...`);
                for (const folder of foldersToDelete) {
                    try {
                        const { ListObjectsV2Command, DeleteObjectsCommand } = await import('@aws-sdk/client-s3');
                        const s3Client = await createS3Client();

                        const listCommand = new ListObjectsV2Command({
                            Bucket: process.env.DO_SPACESBUCKET,
                            Prefix: folder,
                        });

                        const listResponse = await s3Client.send(listCommand);

                        if (listResponse.Contents && listResponse.Contents.length > 0) {
                            const deleteCommand = new DeleteObjectsCommand({
                                Bucket: process.env.DO_SPACESBUCKET,
                                Delete: {
                                    Objects: listResponse.Contents.map(obj => ({ Key: obj.Key })),
                                    Quiet: false
                                }
                            });

                            const deleteResponse = await s3Client.send(deleteCommand);
                            console.log(`🗑️ Deleted episode folder: ${folder} (${listResponse.Contents.length} files)`);

                            if (deleteResponse.Errors && deleteResponse.Errors.length > 0) {
                                console.warn(`⚠️ Some files in ${folder} could not be deleted:`, deleteResponse.Errors);
                            }
                        } else {
                            console.log(`📁 Episode folder ${folder} is empty or doesn't exist`);
                        }
                    } catch (error) {
                        console.error(`❌ Error deleting episode folder ${folder}:`, error.message);
                    }
                }
             
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
                currency,
                [resourceField]: resourceId,
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

        console.log('🗑️ Deleting videos:', videoIds);

        const videos = await prisma.video.findMany({
            where: { id: { in: videoIds } },
            include: {
                film: { select: { id: true } },
                episode: {
                    select: {
                        id: true,
                        seasonId: true,
                        season: {
                            select: {
                                filmId: true
                            }
                        }
                    }
                },
            },
        });

        if (!videos?.length) returnError('Videos not found', 404);

        console.log(`📋 Found ${videos.length} videos to delete`);

        for (let video of videos) {
            if (!video) continue;

            console.log(`🗑️ Processing video: ${video.name} (${video.id})`);

            // Extract base video name for HLS file deletion
            const baseVideoName = video.name.replace(/\.(m3u8|mp4)$/, ''); // Remove extension
            const cleanBaseName = baseVideoName.replace(/^(SD_|HD_|FHD_|UHD_|master_)/, ''); // Remove resolution and master prefixes

            if (video.film) {
                // means that the video is movie
                const resourceId = video.film.id;
                console.log(`🎬 Deleting film video: ${video.name} from bucket: ${resourceId}`);

                // try {
                //     // Delete original video file
                //     await deleteFromBucket({
                //         bucketName: resourceId,
                //         key: video.name,
                //     });
                //     console.log(`✅ Deleted original file: ${video.name}`);
                // } catch (error) {
                //     console.log(`⚠️ Could not delete original file ${video.name}:`, error.message);
                // }

                // Enhanced folder-based deletion for HLS and subtitle files
                const foldersToDelete = [
                    // HLS folders for each resolution
                    `${resourceId}/hls_SD_${cleanBaseName}`,
                    `${resourceId}/hls_HD_${cleanBaseName}`,
                    `${resourceId}/hls_FHD_${cleanBaseName}`,
                    `${resourceId}/hls_UHD_${cleanBaseName}`,
                    `${resourceId}/master_${cleanBaseName}.m3u8`,

                    // Subtitle folders
                    `${resourceId}/subtitles/${cleanBaseName}`,
                ];

                // Individual files to delete (master playlist and original MP4)
                const filesToDelete = [
                    // Master playlist
                    `${resourceId}/master_${cleanBaseName}.m3u8`,

                    // Original MP4 (if exists)
                    `${resourceId}/original_${cleanBaseName}.mp4`,
                ];

                // Delete entire folders from DigitalOcean Spaces
                console.log(`🗑️ Deleting ${foldersToDelete.length} folders from DigitalOcean Spaces...`);
                for (const folder of foldersToDelete) {
                    try {
                        // List all objects in the folder
                        const { ListObjectsV2Command, DeleteObjectsCommand } = await import('@aws-sdk/client-s3');
                        const s3Client = await createS3Client();

                        // List all objects in the folder
                        const listCommand = new ListObjectsV2Command({
                            Bucket: process.env.DO_SPACESBUCKET,
                            Prefix: folder,
                        });

                        const listResponse = await s3Client.send(listCommand);

                        if (listResponse.Contents && listResponse.Contents.length > 0) {
                            // Delete all objects in the folder
                            const deleteCommand = new DeleteObjectsCommand({
                                Bucket: process.env.DO_SPACESBUCKET,
                                Delete: {
                                    Objects: listResponse.Contents.map(obj => ({ Key: obj.Key })),
                                    Quiet: false
                                }
                            });

                            const deleteResponse = await s3Client.send(deleteCommand);
                            console.log(`🗑️ Deleted folder: ${folder} (${listResponse.Contents.length} files)`);

                            if (deleteResponse.Errors && deleteResponse.Errors.length > 0) {
                                console.warn(`⚠️ Some files in ${folder} could not be deleted:`, deleteResponse.Errors);
                            }
                        } else {
                            console.log(`📁 Folder ${folder} is empty or doesn't exist`);
                        }
                    } catch (error) {
                        console.error(`❌ Error deleting folder ${folder}:`, error.message);
                    }
                }

                // Delete individual files
                console.log(`🗑️ Deleting ${filesToDelete.length} individual files...`);
                for (const file of filesToDelete) {
                    try {
                        await deleteFromBucket({
                            bucketName: process.env.DO_SPACESBUCKET,
                            key: file,
                        });
                        console.log(`🗑️ Deleted file: ${file}`);
                    } catch (error) {
                        // Ignore errors for files that don't exist
                        if (error.name !== 'NoSuchKey') {
                            console.error(`❌ Error deleting file ${file}:`, error.message);
                        }
                    }
                }

                // Also try to delete from the resource bucket (for backward compatibility)
                console.log(`🗑️ Cleaning up resource bucket for backward compatibility...`);
                // for (const folder of foldersToDelete) {
                //     try {
                //         const { ListObjectsV2Command, DeleteObjectsCommand } = await import('@aws-sdk/client-s3');
                //         const s3Client = await createS3Client();

                //         const listCommand = new ListObjectsV2Command({
                //             Bucket: resourceId,
                //             Prefix: folder,
                //         });

                //         const listResponse = await s3Client.send(listCommand);

                //         if (listResponse.Contents && listResponse.Contents.length > 0) {
                //             const deleteCommand = new DeleteObjectsCommand({
                //                 Bucket: resourceId,
                //                 Delete: {
                //                     Objects: listResponse.Contents.map(obj => ({ Key: obj.Key })),
                //                     Quiet: false
                //                 }
                //             });

                //             const deleteResponse = await s3Client.send(deleteCommand);
                //             console.log(`🗑️ Deleted from resource bucket: ${folder} (${listResponse.Contents.length} files)`);
                //         }
                //     } catch (error) {
                //         // Ignore errors for resource bucket operations
                //         console.log(`📁 Resource bucket folder ${folder} not found or empty`);
                //     }
                // }

                // Delete individual files from resource bucket
                // for (const file of filesToDelete) {
                //     try {
                //         await deleteFromBucket({
                //             bucketName: resourceId,
                //             key: file,
                //         });
                //         console.log(`🗑️ Deleted file from resource bucket: ${file}`);
                //     } catch (error) {
                //         // Ignore errors for files that don't exist
                //         if (error.name !== 'NoSuchKey') {
                //             console.error(`❌ Error deleting file from resource bucket ${file}:`, error.message);
                //         }
                //     }
                // }
            }

            if (video.episode) {
                // means that the video is an episode
                const resourceId = `${video.episode.season.filmId}-${video.episode.seasonId}`;
                console.log(`📺 Deleting episode video: ${video.name} from bucket: ${resourceId}`);

                // try {
                //     // Delete original video file
                //     await deleteFromBucket({
                //         bucketName: resourceId,
                //         key: video.name,
                //     });
                //     console.log(`✅ Deleted original file: ${video.name}`);
                // } catch (error) {
                //     console.log(`⚠️ Could not delete original file ${video.name}:`, error.message);
                // }

                // Enhanced folder-based deletion for episodes
                const episodeFoldersToDelete = [
                    // HLS folders for each resolution
                    `${resourceId}/hls_SD_${cleanBaseName}`,
                    `${resourceId}/hls_HD_${cleanBaseName}`,
                    `${resourceId}/hls_FHD_${cleanBaseName}`,
                    `${resourceId}/hls_UHD_${cleanBaseName}`,
                    `${resourceId}/master_${cleanBaseName}.m3u8`,

                    // Subtitle folders
                    `${resourceId}/subtitles/${cleanBaseName}`,
                ];

                // Individual files to delete (master playlist and original MP4)
                const episodeFilesToDelete = [
                    // Master playlist
                    `${resourceId}/master_${cleanBaseName}.m3u8`,

                    // Original MP4 (if exists)
                    `${resourceId}/original_${cleanBaseName}.mp4`,
                ];

                // Delete entire folders from DigitalOcean Spaces
                console.log(`🗑️ Deleting ${episodeFoldersToDelete.length} episode folders from DigitalOcean Spaces...`);
                for (const folder of episodeFoldersToDelete) {
                    try {
                        const { ListObjectsV2Command, DeleteObjectsCommand } = await import('@aws-sdk/client-s3');
                        const s3Client = await createS3Client();

                        const listCommand = new ListObjectsV2Command({
                            Bucket: process.env.DO_SPACESBUCKET,
                            Prefix: folder,
                        });

                        const listResponse = await s3Client.send(listCommand);

                        if (listResponse.Contents && listResponse.Contents.length > 0) {
                            const deleteCommand = new DeleteObjectsCommand({
                                Bucket: process.env.DO_SPACESBUCKET,
                                Delete: {
                                    Objects: listResponse.Contents.map(obj => ({ Key: obj.Key })),
                                    Quiet: false
                                }
                            });

                            const deleteResponse = await s3Client.send(deleteCommand);
                            console.log(`🗑️ Deleted episode folder: ${folder} (${listResponse.Contents.length} files)`);

                            if (deleteResponse.Errors && deleteResponse.Errors.length > 0) {
                                console.warn(`⚠️ Some files in ${folder} could not be deleted:`, deleteResponse.Errors);
                            }
                        } else {
                            console.log(`📁 Episode folder ${folder} is empty or doesn't exist`);
                        }
                    } catch (error) {
                        console.error(`❌ Error deleting episode folder ${folder}:`, error.message);
                    }
                }

                // Delete individual episode files
                console.log(`🗑️ Deleting ${episodeFilesToDelete.length} individual episode files...`);
                for (const file of episodeFilesToDelete) {
                    try {
                        await deleteFromBucket({
                            bucketName: process.env.DO_SPACESBUCKET,
                            key: file,
                        });
                        console.log(`🗑️ Deleted episode file: ${file}`);
                    } catch (error) {
                        // Ignore errors for files that don't exist
                        if (error.name !== 'NoSuchKey') {
                            console.error(`❌ Error deleting episode file ${file}:`, error.message);
                        }
                    }
                }

                // Also try to delete from the resource bucket (for backward compatibility)
                console.log(`🗑️ Cleaning up episode resource bucket for backward compatibility...`);
                // for (const folder of episodeFoldersToDelete) {
                //     try {
                //         const { ListObjectsV2Command, DeleteObjectsCommand } = await import('@aws-sdk/client-s3');
                //         const s3Client = await createS3Client();

                //         const listCommand = new ListObjectsV2Command({
                //             Bucket: resourceId,
                //             Prefix: folder,
                //         });

                //         const listResponse = await s3Client.send(listCommand);

                //         if (listResponse.Contents && listResponse.Contents.length > 0) {
                //             const deleteCommand = new DeleteObjectsCommand({
                //                 Bucket: resourceId,
                //                 Delete: {
                //                     Objects: listResponse.Contents.map(obj => ({ Key: obj.Key })),
                //                     Quiet: false
                //                 }
                //             });

                //             const deleteResponse = await s3Client.send(deleteCommand);
                //             console.log(`🗑️ Deleted episode from resource bucket: ${folder} (${listResponse.Contents.length} files)`);
                //         }
                //     } catch (error) {
                //         // Ignore errors for resource bucket operations
                //         console.log(`📁 Episode resource bucket folder ${folder} not found or empty`);
                //     }
                // }

                // Delete individual episode files from resource bucket
                // for (const file of episodeFilesToDelete) {
                //     try {
                //         await deleteFromBucket({
                //             bucketName: resourceId,
                //             key: file,
                //         });
                //         console.log(`🗑️ Deleted episode file from resource bucket: ${file}`);
                //     } catch (error) {
                //         // Ignore errors for files that don't exist
                //         if (error.name !== 'NoSuchKey') {
                //             console.error(`❌ Error deleting episode file from resource bucket ${file}:`, error.message);
                //         }
                //     }
                // }
            }
        }



        // Extract base video name for HLS file deletion
        const baseVideoName = videos[0].name.replace(/\.(m3u8|mp4)$/, ''); // Remove extension
        const cleanBaseName = baseVideoName.replace(/^(SD_|HD_|FHD_|UHD_|master_)/, ''); // Remove resolution and master prefixes

        //delete the master playlist from database
        const findMasterPlaylist = await prisma.video.findFirst({
            where: { name: `master_${cleanBaseName}.m3u8` },
        });

        if (findMasterPlaylist) {
            // delete film from database
            await prisma.video.delete({
                where: { id: findMasterPlaylist.id },
            });
        } else { }

        //delete the subtitle from database
        let subtitleResourceId = null;
        if (videos[0].film) {
            subtitleResourceId = videos[0].film.id;
        } else if (videos[0].episode) {
            subtitleResourceId = videos[0].episode.id;
        }
        const findSubtitle = await prisma.subtitle.findMany({
            where: { resourceId: subtitleResourceId, },
        });

        if (findSubtitle) {
            // delete subtitle from database
            await prisma.subtitle.deleteMany({
                where: { id: { in: findSubtitle.map(subtitle => subtitle.id) } },
            });
        }

        console.log(`✅ Successfully deleted ${findSubtitle.length} subtitles from database`);

        // delete videos from database
        const deletedVideos = await prisma.video.deleteMany({
            where: { id: { in: videoIds } },
        });

        console.log(`✅ Successfully deleted ${deletedVideos.count} videos from database`);

        res.status(200).json({
            message: `Videos, HLS folders, and subtitle folders deleted successfully from DigitalOcean Spaces. Deleted ${deletedVideos.count} videos.`,
            deletedCount: deletedVideos.count
        });
    } catch (error) {
        console.error('❌ Error in deleteVideos:', error);

        if (!error.statusCode) {
            error.statusCode = 500;
        }

        next(error);
    }
};

// Video Processing Job Management

/**
 * @name getVideoProcessingJobs
 * @description Get all video processing jobs with their status
 * @type {import('express').RequestHandler}
 */
export const getVideoProcessingJobs = async (req, res, next) => {
    try {
        const { status, type } = req.query;

        const filter = {};
        if (status) filter.status = status;
        if (type) filter.type = type;

        const jobs = await prisma.videoProcessingJob.findMany({
            where: filter,
            include: {
                film: {
                    select: {
                        id: true,
                        title: true,
                        type: true,
                    },
                },
                episode: {
                    select: {
                        id: true,
                        title: true,
                        episode: true,
                        season: {
                            select: {
                                id: true,
                                season: true,
                                film: {
                                    select: {
                                        id: true,
                                        title: true,
                                    },
                                },
                            },
                        },
                    },
                },
            },
            orderBy: {
                createdAt: 'desc',
            },
        });

        // Get queue statistics
        const queueStats = {
            total: jobs.length,
            waiting: jobs.filter(job => job.status === 'waiting').length,
            active: jobs.filter(job => job.status === 'active').length,
            completed: jobs.filter(job => job.status === 'completed').length,
            failed: jobs.filter(job => job.status === 'failed').length,
            cancelled: jobs.filter(job => job.status === 'cancelled').length,
        };

        res.status(200).json({
            jobs,
            stats: queueStats,
        });
    } catch (error) {
        if (!error.statusCode) {
            error.statusCode = 500;
        }
        next(error);
    }
};

/**
 * @name getVideoProcessingJob
 * @description Get a specific video processing job by ID
 * @type {import('express').RequestHandler}
 */
export const getVideoProcessingJob = async (req, res, next) => {
    try {
        const { jobId } = req.params;

        if (!jobId) returnError('Job ID is required', 400);

        const job = await prisma.videoProcessingJob.findUnique({
            where: { id: jobId },
            include: {
                film: {
                    select: {
                        id: true,
                        title: true,
                        type: true,
                    },
                },
                episode: {
                    select: {
                        id: true,
                        title: true,
                        episode: true,
                        season: {
                            select: {
                                id: true,
                                season: true,
                                film: {
                                    select: {
                                        id: true,
                                        title: true,
                                    },
                                },
                            },
                        },
                    },
                },
            },
        });

        if (!job) returnError('Job not found', 404);

        // Get BullMQ job details if still in queue
        let queueJobDetails = null;
        try {
            const queueJob = await videoQueue.getJob(job.jobId);
            if (queueJob) {
                queueJobDetails = {
                    progress: queueJob.progress,
                    state: await queueJob.getState(),
                    processedOn: queueJob.processedOn,
                    finishedOn: queueJob.finishedOn,
                    failedReason: queueJob.failedReason,
                };
            }
        } catch (queueError) {
            console.log('Could not fetch queue job details:', queueError.message);
        }

        res.status(200).json({
            job,
            queueDetails: queueJobDetails,
        });
    } catch (error) {
        if (!error.statusCode) {
            error.statusCode = 500;
        }
        next(error);
    }
};

/**
 * @name cancelVideoProcessingJob
 * @description Cancel a video processing job
 * @type {import('express').RequestHandler}
 */
export const cancelVideoProcessingJob = async (req, res, next) => {
    try {
        const { jobId } = req.params;

        if (!jobId) returnError('Job ID is required', 400);

        const job = await prisma.videoProcessingJob.findUnique({
            where: { id: jobId },
        });

        if (!job) returnError('Job not found', 404);

        if (!job.canCancel) {
            returnError('This job cannot be cancelled', 400);
        }

        if (['completed', 'failed', 'cancelled'].includes(job.status)) {
            returnError('Job is already finished', 400);
        }

        // Try to cancel/remove the BullMQ job
        try {
            const queueJob = await videoQueue.getJob(job.jobId);
            if (queueJob) {
                const jobState = await queueJob.getState();

                if (jobState === 'waiting' || jobState === 'delayed') {
                    // Job hasn't started yet, we can remove it
                    await queueJob.remove();
                } else if (jobState === 'active') {
                    // Job is currently processing, we can't remove it but we can mark it as cancelled
                    // The worker should check for cancellation periodically
                    console.log(`Job ${job.jobId} is active, marking as cancelled`);
                }
            }
        } catch (queueError) {
            console.log('Could not cancel queue job:', queueError.message);
            // Continue with database update even if queue operation fails
        }

        // Clean up film folders when cancelling
        await cleanupFilmFolder(job.resourceId, job.type, job.fileName);

        // Update database status
        await prisma.videoProcessingJob.update({
            where: { id: jobId },
            data: {
                status: 'cancelled',
                cancelledAt: new Date(),
                canCancel: false,
            },
        });

        // Emit cancellation event to client
        try {
            const { resourceId } = job;
            io.to(resourceId).emit('JobCancelled', {
                message: 'Job was cancelled',
                jobId: job.jobId,
                clientId: resourceId
            });
        } catch (socketError) {
            console.log('Could not emit cancellation event:', socketError.message);
        }

        res.status(200).json({
            message: job.status === 'active' ? 'Job stop request sent successfully' : 'Job cancelled successfully',
        });
    } catch (error) {
        if (!error.statusCode) {
            error.statusCode = 500;
        }
        next(error);
    }
};

/**
 * @name deleteVideoProcessingJob
 * @description Delete a video processing job record
 * @type {import('express').RequestHandler}
 */
export const deleteVideoProcessingJob = async (req, res, next) => {
    try {
        const { jobId } = req.params;

        if (!jobId) returnError('Job ID is required', 400);

        const job = await prisma.videoProcessingJob.findUnique({
            where: { id: jobId },
        });

        if (!job) returnError('Job not found', 404);

        // Only allow deletion of completed, failed, or cancelled jobs
        if (!['completed', 'failed', 'cancelled'].includes(job.status)) {
            returnError('Cannot delete active or waiting jobs. Cancel them first.', 400);
        }

        await prisma.videoProcessingJob.delete({
            where: { id: jobId },
        });

        res.status(200).json({
            message: 'Job record deleted successfully',
        });
    } catch (error) {
        if (!error.statusCode) {
            error.statusCode = 500;
        }
        next(error);
    }
};

/**
 * @name retryVideoProcessingJob
 * @description Retry a failed video processing job
 * @type {import('express').RequestHandler}
 */
export const retryVideoProcessingJob = async (req, res, next) => {
    try {
        const { jobId } = req.params;

        if (!jobId) returnError('Job ID is required', 400);

        const job = await prisma.videoProcessingJob.findUnique({
            where: { id: jobId },
            include: {
                film: true,
                episode: {
                    include: {
                        season: {
                            select: { id: true, filmId: true }
                        }
                    }
                }
            },
        });

        if (!job) returnError('Job not found', 404);

        if (job.status !== 'failed') {
            returnError('Only failed jobs can be retried', 400);
        }

        // Log job details for debugging
        console.log(`🔄 Retrying video processing job:`, {
            jobId,
            type: job.resourceType,
            resourceId: job.resourceId,
            status: job.status,
            hasFilm: !!job.film,
            hasEpisode: !!job.episode,
            episodeSeasonId: job.episode?.season?.id,
            episodeFilmId: job.episode?.season?.filmId
        });

        // Create new queue job
        const resource = job.film || job.episode;
        
        // Validate that we have the required resource data
        if (!resource) {
            returnError(`Job ${jobId} is missing resource data (film or episode)`, 400);
        }
        
        // Safely determine bucket name based on job type
        let bucketName;
        if (job.resourceType === 'film') {
            bucketName = job.resourceId;
            console.log(`🎬 Film job: using resourceId as bucket name: ${bucketName}`);
        } else if (job.resourceType === 'episode' && job.episode && job.episode.season) {
            bucketName = `${job.episode.season.filmId}-${job.episode.season.id}`;
            console.log(`📺 Episode job: using season-based bucket name: ${bucketName}`);
        } else {
            // Fallback for episodes without season data
            bucketName = job.resourceId;
            console.warn(`⚠️ Episode job ${jobId} missing season data, using resourceId as bucket name: ${bucketName}`);
        }

       
        const { filename, ext } = new ChunkService().formatFileName(job.fileName);
        
        const filePath = path.join(UPLOAD_DIR, `${filename}.${ext}`);
        const newQueueJob = await videoQueue.add('transcode-video', {
            type: job.resourceType,
            filePath,
            resourceId: job.resourceId,
            resource,
            fileName: job.fileName,
            filename,
            clientId: 'retry-' + Date.now(), // Generate a new client ID
            bucketName,
            outputDir: UPLOAD_DIR,
        });

        // Update job record
        await prisma.videoProcessingJob.update({
            where: { id: jobId },
            data: {
                jobId: newQueueJob.id.toString(),
                status: 'waiting',
                progress: 0,
                canCancel: true,
                cancelledAt: null,
                failedReason: null,
            },
        });

        console.log(`✅ Job ${jobId} successfully queued for retry with new job ID: ${newQueueJob.id}`);
        
        res.status(200).json({
            message: 'Job queued for retry',
            newJobId: newQueueJob.id.toString(),
            originalJobId: jobId,
            bucketName,
            type: job.resourceType
        });
    } catch (error) {
        if (!error.statusCode) {
            error.statusCode = 500;
        }
        next(error);
    }
};

/**
 * @name clearCompletedJobs
 * @description Clear all completed and failed job records
 * @type {import('express').RequestHandler}
 */
export const clearCompletedJobs = async (req, res, next) => {
    try {
        const { status } = req.body; // 'completed', 'failed', 'cancelled', or 'all'

        let whereClause = {};

        if (status === 'all') {
            whereClause = {
                status: {
                    in: ['completed', 'failed', 'cancelled']
                }
            };
        } else if (['completed', 'failed', 'cancelled'].includes(status)) {
            whereClause = { status };
        } else {
            returnError('Invalid status. Use "completed", "failed", "cancelled", or "all"', 400);
        }

        // Get jobs before deleting them for cleanup
        const jobsToDelete = await prisma.videoProcessingJob.findMany({
            where: whereClause,
        });

        // Clean up folders for failed jobs
        for (const job of jobsToDelete) {
            if (job.status === 'failed') {
                await cleanupFilmFolder(job.resourceId, job.type, job.fileName);
            }
        }

        const deletedJobs = await prisma.videoProcessingJob.deleteMany({
            where: whereClause,
        });

        res.status(200).json({
            message: `Cleared ${deletedJobs.count} job records`,
            deletedCount: deletedJobs.count,
        });
    } catch (error) {
        if (!error.statusCode) {
            error.statusCode = 500;
        }
        next(error);
    }
};

/**
 * @name cleanupFailedJob
 * @description Clean up folders for a specific failed job
 * @type {import('express').RequestHandler}
 */
export const cleanupFailedJob = async (req, res, next) => {
    try {
        const { jobId } = req.params;

        if (!jobId) returnError('Job ID is required', 400);

        const job = await prisma.videoProcessingJob.findUnique({
            where: { id: jobId },
        });

        if (!job) returnError('Job not found', 404);

        if (job.status !== 'failed') {
            returnError('Only failed jobs can be cleaned up', 400);
        }

        // Clean up film folders
        await cleanupFilmFolder(job.resourceId, job.type, job.fileName);

        res.status(200).json({
            message: 'Job folders cleaned up successfully',
        });
    } catch (error) {
        if (!error.statusCode) {
            error.statusCode = 500;
        }
        next(error);
    }
};

/**
 * @name checkExistingProcessingJob
 * @description Check if there's an existing processing job for a resource
 * @type {import('express').RequestHandler}
 */
export const checkExistingProcessingJob = async (req, res, next) => {
    try {
        const { resourceId, type, jobType } = req.query;

        if (!resourceId) returnError('Resource ID is required', 400);
        if (!type) returnError('Type is required', 400);

        // Build the where clause
        const whereClause = {
            resourceId,
            resourceType: type, // Use resourceType instead of type
            status: {
                notIn: ['completed', 'failed', 'cancelled']
            }
        };

        // Add jobType filter if provided
        if (jobType) {
            whereClause.jobType = jobType;
        }

        // Check for existing jobs that are not completed, failed, or cancelled
        const existingJob = await prisma.videoProcessingJob.findFirst({
            where: whereClause,
            orderBy: {
                createdAt: 'desc'
            }
        });

        res.status(200).json({
            hasExistingJob: !!existingJob,
            existingJob: existingJob ? {
                id: existingJob.id,
                jobId: existingJob.jobId,
                jobType: existingJob.jobType,
                status: existingJob.status,
                fileName: existingJob.fileName,
                createdAt: existingJob.createdAt,
                progress: existingJob.progress
            } : null
        });
    } catch (error) {
        if (!error.statusCode) {
            error.statusCode = 500;
        }
        next(error);
    }
};

/**
 * @name syncJobStatus
 * @description Sync job status with BullMQ queue state
 * @type {import('express').RequestHandler}
 */
export const syncJobStatus = async (req, res, next) => {
    try {
        const { jobId } = req.params;

        if (!jobId) returnError('Job ID is required', 400);

        const job = await prisma.videoProcessingJob.findUnique({
            where: { id: jobId },
        });

        if (!job) returnError('Job not found', 404);

        // Get BullMQ job details
        let queueJobDetails = null;
        try {
            const queueJob = await videoQueue.getJob(job.jobId);
            if (queueJob) {
                const jobState = await queueJob.getState();
                queueJobDetails = {
                    progress: queueJob.progress,
                    state: jobState,
                    processedOn: queueJob.processedOn,
                    finishedOn: queueJob.finishedOn,
                    failedReason: queueJob.failedReason,
                };

                // Sync status based on queue state
                let newStatus = job.status;
                if (jobState === 'active' && job.status === 'waiting') {
                    newStatus = 'active';
                } else if (jobState === 'completed' && job.status !== 'completed') {
                    newStatus = 'completed';
                } else if (jobState === 'failed' && job.status !== 'failed') {
                    newStatus = 'failed';
                }

                if (newStatus !== job.status) {
                    await prisma.videoProcessingJob.update({
                        where: { id: jobId },
                        data: {
                            status: newStatus,
                            progress: jobState === 'completed' ? 100 : job.progress,
                            failedReason: jobState === 'failed' ? queueJob.failedReason : job.failedReason,
                        },
                    });
                }
            }
        } catch (queueError) {
            console.log('Could not fetch queue job details:', queueError.message);
        }

        res.status(200).json({
            message: 'Job status synced successfully',
            job: {
                ...job,
                queueDetails: queueJobDetails,
            },
        });
    } catch (error) {
        if (!error.statusCode) {
            error.statusCode = 500;
        }
        next(error);
    }
};

/**
 * @name fixStuckJobs
 * @description Fix jobs that are stuck in waiting state but actually processing
 * @type {import('express').RequestHandler}
 */
export const fixStuckJobs = async (req, res, next) => {
    try {
        console.log('🔧 Fixing stuck jobs...');

        // Get all stuck jobs (active for more than 2 hours)
        const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);

        const stuckJobs = await prisma.videoProcessingJob.findMany({
            where: {
                status: 'active',
                updatedAt: {
                    lt: twoHoursAgo
                }
            }
        });

        console.log(`🔧 Found ${stuckJobs.length} stuck jobs`);

        let fixedCount = 0;
        for (const job of stuckJobs) {
            try {
                // Check if the job actually exists in the queue
                const queueJob = await videoQueue.getJob(job.jobId);

                if (!queueJob) {
                    // Job doesn't exist in queue, mark as failed
                    await prisma.videoProcessingJob.update({
                        where: { id: job.id },
                        data: {
                            status: 'failed',
                            failedReason: 'Job not found in queue - marked as stuck',
                            canCancel: false
                        }
                    });
                    fixedCount++;
                    console.log(`🔧 Fixed stuck job ${job.jobId} - marked as failed`);
                } else {
                    // Job exists in queue, check its state
                    const jobState = await queueJob.getState();

                    if (jobState === 'failed' || jobState === 'completed') {
                        // Update database to match queue state
                        await prisma.videoProcessingJob.update({
                            where: { id: job.id },
                            data: {
                                status: jobState === 'failed' ? 'failed' : 'completed',
                                failedReason: jobState === 'failed' ? 'Job failed in queue' : null,
                                canCancel: false
                            }
                        });
                        fixedCount++;
                        console.log(`🔧 Fixed stuck job ${job.jobId} - synced with queue state: ${jobState}`);
                    }
                }
            } catch (error) {
                console.error(`🔧 Error fixing job ${job.jobId}:`, error.message);
            }
        }

        res.status(200).json({
            success: true,
            message: `Fixed ${fixedCount} stuck jobs out of ${stuckJobs.length} found`,
            fixedCount,
            totalFound: stuckJobs.length
        });

    } catch (error) {
        console.error('🔧 Error fixing stuck jobs:', error);
        return returnError(res, 500, 'Failed to fix stuck jobs');
    }
};

// Subtitle Management Functions
export const uploadSubtitle = async (req, res, next) => {
    try {
        console.log('📝 Upload subtitle request received');
        console.log('📝 Request body:', req.body);
        console.log('📝 Request file:', req.file);
        console.log('📝 Request files:', req.files);

        const { resourceId, type, language, label } = req.body;
        const subtitleFile = req.file;

        if (!subtitleFile) {
            console.log('❌ No subtitle file found in request');
            console.log('📝 Available fields:', Object.keys(req));
            return returnError('No subtitle file provided', 400);
        }

        if (!resourceId || !type) {
            return returnError('Resource ID and type are required', 400);
        }

        console.log('📝 File details:', {
            originalname: subtitleFile.originalname,
            mimetype: subtitleFile.mimetype,
            size: subtitleFile.size,
            path: subtitleFile.path
        });

        // Validate file type
        if (subtitleFile.mimetype !== 'text/vtt' && !subtitleFile.originalname.endsWith('.vtt')) {
            return returnError('Only .vtt subtitle files are supported', 400);
        }

        // Detect language from filename or use provided language
        let detectedLanguage = 'eng'; // Default fallback

        if (language && language.trim()) {
            // Use provided language from request body (takes priority)
            detectedLanguage = language.trim().toLowerCase();
            console.log(`🌍 Using provided language from request: ${detectedLanguage}`);
        } else {
            // Try to detect language from filename only if no language provided
            const filename = subtitleFile.originalname.toLowerCase();
            console.log(`🌍 Attempting to detect language from filename: ${filename}`);

            // Common language patterns in subtitle filenames
            const languagePatterns = {
                'eng': ['eng', 'english', 'en'],
                'spa': ['spa', 'spanish', 'es'],
                'fra': ['fra', 'french', 'fr'],
                'deu': ['deu', 'german', 'de'],
                'ita': ['ita', 'italian', 'it'],
                'por': ['por', 'portuguese', 'pt'],
                'rus': ['rus', 'russian', 'ru'],
                'jpn': ['jpn', 'japanese', 'ja'],
                'kor': ['kor', 'korean', 'ko'],
                'chi': ['chi', 'chinese', 'zh'],
                'ara': ['ara', 'arabic', 'ar'],
                'hin': ['hin', 'hindi', 'hi'],
                'ben': ['ben', 'bengali', 'bn'],
                'tel': ['tel', 'telugu', 'te'],
                'tam': ['tam', 'tamil', 'ta'],
                'mar': ['mar', 'marathi', 'mr'],
                'guj': ['guj', 'gujarati', 'gu'],
                'kan': ['kan', 'kannada', 'kn'],
                'mal': ['mal', 'malayalam', 'ml'],
                'urd': ['urd', 'urdu', 'ur'],
                'swa': ['swa', 'swahili', 'sw'],
                'zul': ['zul', 'zulu', 'zu'],
                'xho': ['xho', 'xhosa', 'xh'],
                'afr': ['afr', 'afrikaans', 'af'],
                'nld': ['nld', 'dutch', 'nl'],
                'swe': ['swe', 'swedish', 'sv'],
                'nor': ['nor', 'norwegian', 'no'],
                'dan': ['dan', 'danish', 'da'],
                'fin': ['fin', 'finnish', 'fi'],
                'pol': ['pol', 'polish', 'pl'],
                'cze': ['cze', 'czech', 'cs'],
                'slk': ['slk', 'slovak', 'sk'],
                'hun': ['hun', 'hungarian', 'hu'],
                'rom': ['rom', 'romanian', 'ro'],
                'bul': ['bul', 'bulgarian', 'bg'],
                'hrv': ['hrv', 'croatian', 'hr'],
                'srp': ['srp', 'serbian', 'sr'],
                'slv': ['slv', 'slovenian', 'sl'],
                'est': ['est', 'estonian', 'et'],
                'lav': ['lav', 'latvian', 'lv'],
                'lit': ['lit', 'lithuanian', 'lt'],
                'tur': ['tur', 'turkish', 'tr'],
                'ell': ['ell', 'greek', 'el'],
                'heb': ['heb', 'hebrew', 'he'],
                'fas': ['fas', 'persian', 'fa'],
                'tha': ['tha', 'thai', 'th'],
                'vie': ['vie', 'vietnamese', 'vi'],
                'ind': ['ind', 'indonesian', 'id'],
                'msa': ['msa', 'malay', 'ms'],
                'fil': ['fil', 'filipino', 'tl'],
                'may': ['may', 'malay', 'ms'],
                'tgl': ['tgl', 'tagalog', 'tl']
            };

            // Check for language patterns in filename
            for (const [langCode, patterns] of Object.entries(languagePatterns)) {
                if (patterns.some(pattern => filename.includes(pattern))) {
                    detectedLanguage = langCode;
                    console.log(`🌍 Detected language from filename: ${detectedLanguage} (matched pattern: ${patterns.find(p => filename.includes(p))})`);
                    break;
                }
            }
        }

        // Generate label if not provided
        let subtitleLabel = label;
        if (!subtitleLabel || subtitleLabel.trim() === '') {
            // Generate a user-friendly label based on language
            const languageNames = {
                'eng': 'English',
                'spa': 'Spanish',
                'fra': 'French',
                'deu': 'German',
                'ita': 'Italian',
                'por': 'Portuguese',
                'rus': 'Russian',
                'jpn': 'Japanese',
                'kor': 'Korean',
                'chi': 'Chinese',
                'ara': 'Arabic',
                'hin': 'Hindi',
                'ben': 'Bengali',
                'tel': 'Telugu',
                'tam': 'Tamil',
                'mar': 'Marathi',
                'guj': 'Gujarati',
                'kan': 'Kannada',
                'mal': 'Malayalam',
                'urd': 'Urdu',
                'swa': 'Swahili',
                'zul': 'Zulu',
                'xho': 'Xhosa',
                'afr': 'Afrikaans',
                'nld': 'Dutch',
                'swe': 'Swedish',
                'nor': 'Norwegian',
                'dan': 'Danish',
                'fin': 'Finnish',
                'pol': 'Polish',
                'cze': 'Czech',
                'slk': 'Slovak',
                'hun': 'Hungarian',
                'rom': 'Romanian',
                'bul': 'Bulgarian',
                'hrv': 'Croatian',
                'srp': 'Serbian',
                'slv': 'Slovenian',
                'est': 'Estonian',
                'lav': 'Latvian',
                'lit': 'Lithuanian',
                'tur': 'Turkish',
                'ell': 'Greek',
                'heb': 'Hebrew',
                'fas': 'Persian',
                'tha': 'Thai',
                'vie': 'Vietnamese',
                'ind': 'Indonesian',
                'msa': 'Malay',
                'fil': 'Filipino',
                'may': 'Malay',
                'tgl': 'Tagalog'
            };

            subtitleLabel = languageNames[detectedLanguage] || detectedLanguage.toUpperCase();
            console.log(`🏷️ Generated label: ${subtitleLabel}`);
        }

        console.log(`🌍 Final language to be used: ${detectedLanguage}`);
        console.log(`🏷️ Final label to be used: ${subtitleLabel}`);

        // Get the original video name from the resource
        const videos = await prisma.video.findMany({
            where: {
                OR: [
                    { filmId: resourceId },
                    { episodeId: resourceId },
                    { seasonId: resourceId }
                ]
            },
            select: {
                id: true,
                name: true,
                resolution: true,
                season: {
                    select: {
                      id: true,
                      filmId: true
                    }
                  },
                  episode: {
                    select: {
                      season: {
                        select: {
                          id: true,
                          filmId: true
                        }
                      }
                    }
                  }
            },
            take: 1 // Just get the first video
        });

        if (videos.length === 0) {
            return returnError('No videos found for this resource', 404);
        }

        const firstVideo = videos[0];
        const baseVideoName = firstVideo.name.replace(/\.(m3u8|mp4)$/, ''); // Remove extension
        const cleanBaseName = baseVideoName.replace(/^(SD_|HD_|FHD_|UHD_|master_)/, ''); // Remove resolution and master prefixes

        console.log(`🎬 Original video name: ${cleanBaseName}`);

        // Create temporary file for upload
        const tempSubtitlePath = path.join(UPLOAD_DIR, `${subtitleFile.originalname}`);

        try {
            // Write buffer to temporary file
            fs.writeFileSync(tempSubtitlePath, subtitleFile.buffer);
            console.log(`📝 Created temporary subtitle file: ${tempSubtitlePath}`);
            let bucketName
            // Use existing uploadSubtitleToDO function with subtitle metadata
            if (type === 'film'){
                bucketName = resourceId
            } else if (firstVideo.episode?.season?.filmId){
                bucketName = `${firstVideo?.episode?.season?.filmId}-${firstVideo?.episode?.season?.id}`;
            } else {
                bucketName = `${firstVideo?.season?.filmId}-${firstVideo?.season?.id}`;
            }
             
            const uploadPath = `subtitles/${cleanBaseName}/`;

            const subtitleMetadata = {
                filename: subtitleFile.originalname,
                language: detectedLanguage,
                label: subtitleLabel,
                fileSize: subtitleFile.size
            };

            const result = await uploadSubtitleToDO({
                subtitlePath: tempSubtitlePath,
                filename: cleanBaseName,
                resourceId: resourceId,
                bucketName: bucketName,
                clientId: resourceId, // Use resourceId as clientId for socket events
                type: type,
                uploadPath: uploadPath,
                subtitleMetadata: subtitleMetadata // Pass metadata for database creation
            });

            console.log('✅ Subtitle uploaded successfully using existing uploadSubtitleToDO function');

            res.status(200).json({
                success: true,
                message: 'Subtitle uploaded successfully',
                subtitle: {
                    id: result.subtitleId,
                    filename: subtitleFile.originalname,
                    language: detectedLanguage,
                    label: subtitleLabel
                }
            });

        } catch (uploadError) {
            console.error('❌ Error during subtitle upload:', uploadError);

            // Clean up temporary file if it exists
            if (fs.existsSync(tempSubtitlePath)) {
                fs.unlinkSync(tempSubtitlePath);
                console.log(`🗑️ Cleaned up temporary file: ${tempSubtitlePath}`);
            }

            return returnError(`Subtitle upload failed: ${uploadError.message}`, 500);
        }

    } catch (error) {
        console.error('❌ Error uploading subtitle:', error);
        return returnError('Failed to upload subtitle', 500);
    }
};

export const deleteSubtitle = async (req, res, next) => {
    try {
        const { subtitleId } = req.params;

        if (!subtitleId) {
            return returnError('Subtitle ID is required', 400);
        }

        console.log(`🗑️ Deleting subtitle: ${subtitleId}`);

        // Find the subtitle first to get its details
        const subtitle = await prisma.subtitle.findUnique({
            where: { id: subtitleId }
        });

        if (!subtitle) {
            return returnError('Subtitle not found', 404);
        }

        console.log(`📝 Found subtitle to delete:`, {
            id: subtitle.id,
            filename: subtitle.filename,
            language: subtitle.language,
            resourceId: subtitle.resourceId,
            resourceType: subtitle.resourceType
        });

        // Delete from S3 if URL exists
        if (subtitle.s3Url) {
            try {
                const s3Client = await createS3Client();
                const key = subtitle.s3Url.split('.com/')[1]; // Extract key from URL

                if (key) {
                    console.log(`🗑️ Deleting subtitle from S3: ${key}`);
                    await s3Client.deleteObject({
                        Bucket: process.env.DO_SPACESBUCKET,
                        Key: key
                    });
                    console.log(`✅ Subtitle deleted from S3: ${key}`);
                }
            } catch (s3Error) {
                console.warn(`⚠️ Failed to delete subtitle from S3:`, s3Error.message);
                // Continue with database deletion even if S3 deletion fails
            }
        }

        // Delete from database
        await prisma.subtitle.delete({
            where: { id: subtitleId }
        });

        console.log(`✅ Subtitle deleted from database: ${subtitleId}`);

        res.status(200).json({
            success: true,
            message: 'Subtitle deleted successfully'
        });

    } catch (error) {
        console.error('❌ Error deleting subtitle:', error);
        return returnError('Failed to delete subtitle', 500);
    }
};

export const updateSubtitle = async (req, res, next) => {
    try {
        const { subtitleId } = req.params;
        const { label } = req.body;

        if (!subtitleId) {
            return returnError('Subtitle ID is required', 400);
        }

        if (!label || label.trim() === '') {
            return returnError('Label is required', 400);
        }

        console.log(`📝 Updating subtitle label: ${subtitleId} -> "${label}"`);

        // Find the subtitle first to verify it exists
        const existingSubtitle = await prisma.subtitle.findUnique({
            where: { id: subtitleId }
        });

        if (!existingSubtitle) {
            return returnError('Subtitle not found', 404);
        }

        console.log(`📝 Found subtitle to update:`, {
            id: existingSubtitle.id,
            filename: existingSubtitle.filename,
            language: existingSubtitle.language,
            currentLabel: existingSubtitle.label,
            newLabel: label
        });

        // Update the subtitle label
        const updatedSubtitle = await prisma.subtitle.update({
            where: { id: subtitleId },
            data: {
                label: label.trim(),
                updatedAt: new Date()
            }
        });

        console.log(`✅ Subtitle label updated successfully: ${subtitleId}`);

        res.status(200).json({
            success: true,
            message: 'Subtitle label updated successfully',
            subtitle: {
                id: updatedSubtitle.id,
                filename: updatedSubtitle.filename,
                language: updatedSubtitle.language,
                label: updatedSubtitle.label,
                resourceId: updatedSubtitle.resourceId,
                resourceType: updatedSubtitle.resourceType
            }
        });

    } catch (error) {
        console.error('❌ Error updating subtitle:', error);
        return returnError('Failed to update subtitle', 500);
    }
};

// Upload Job Management Functions

/**
 * @name getUploadJobs
 * @description Get all upload jobs with their status
 * @type {import('express').RequestHandler}
 */
export const getUploadJobs = async (req, res, next) => {
    try {
        const { status, type } = req.query;

        const filter = {};
        if (status) filter.status = status;
        if (type) filter.type = type;

        const jobs = await prisma.uploadJob.findMany({
            where: filter,
            include: {
                film: {
                    select: {
                        id: true,
                        title: true,
                        type: true,
                    },
                },
                episode: {
                    select: {
                        id: true,
                        title: true,
                        episode: true,
                        season: {
                            select: {
                                id: true,
                                season: true,
                                film: {
                                    select: {
                                        id: true,
                                        title: true,
                                    },
                                },
                            },
                        },
                    },
                },
            },
            orderBy: {
                createdAt: 'desc',
            },
        });

        // Get queue statistics
        const queueStats = {
            total: jobs.length,
            waiting: jobs.filter(job => job.status === 'waiting').length,
            active: jobs.filter(job => job.status === 'active').length,
            completed: jobs.filter(job => job.status === 'completed').length,
            failed: jobs.filter(job => job.status === 'failed').length,
            cancelled: jobs.filter(job => job.status === 'cancelled').length,
        };

        res.status(200).json({
            jobs,
            stats: queueStats,
        });
    } catch (error) {
        if (!error.statusCode) {
            error.statusCode = 500;
        }
        next(error);
    }
};

/**
 * @name retryUploadJob
 * @description Retry a failed upload job
 * @type {import('express').RequestHandler}
 */
export const retryUploadJob = async (req, res, next) => {
    try {
        const { jobId } = req.params;

        if (!jobId) returnError('Job ID is required', 400);

        const job = await prisma.uploadJob.findUnique({
            where: { id: jobId },
            include: {
                film: { select: { id: true } },
                episode: {
                    select: {
                        id: true,
                        seasonId: true,
                        season: {
                            select: {
                                id: true,
                                filmId: true
                            }
                        }
                    }
                },
                season: {
                    select: {
                        id: true,
                        filmId: true
                    }
                },
            },
        });

        if (!job) returnError('Upload job not found', 404);

        if (job.status !== 'failed') {
            returnError('Only failed upload jobs can be retried', 400);
        }

        // Log job details for debugging
        console.log('🔄 Retrying upload job:', {
            jobId: job.id,
            jobType: job.jobType,
            resourceType: job.resourceType,
            resourceId: job.resourceId,
            status: job.status
        });

        // Create new queue job based on job type
        let newQueueJob;

        // Determine bucket name based on resource type and ID
        let bucketName;
        if (job.resourceType === 'film') {
            bucketName = job.resourceId;
        } else if (job.resourceType === 'episode') {
            // For episodes, we need to construct the bucket name from the resource ID
            // The resourceId should already contain the format: filmId-seasonId
            bucketName = job.resourceId;
        } else if (job.resourceType === 'season') {
            // For seasons, construct bucket name from season data
            bucketName = job.resourceId;
        } else {
            // Fallback to the resourceId if type is not specified
            bucketName = job.resourceId;
        }

        // Validate required fields based on job type
        if (job.jobType === 'upload-hls-to-s3') {
            if (!job.hlsDir) {
                returnError('HLS directory path is required for HLS upload jobs', 400);
            }
            if (!job.resourceId) {
                returnError('Resource ID is required for HLS upload jobs', 400);
            }
        }
        if (job.jobType === 'upload-master-playlist') {
            if (!job.masterPlaylistPath) {
                returnError('Master playlist path is required for master playlist upload jobs', 400);
            }
            if (!job.resourceId) {
                returnError('Resource ID is required for master playlist upload jobs', 400);
            }
        }
        if (job.jobType === 'upload-subtitle-to-s3') {
            if (!job.subtitlePath) {
                returnError('Subtitle path is required for subtitle upload jobs', 400);
            }
            if (!job.resourceId) {
                returnError('Resource ID is required for subtitle upload jobs', 400);
            }
        }

        if (job.jobType === 'upload-hls-to-s3') {
            // Retry HLS upload
            newQueueJob = await hlsUploadQueue.add('upload-hls-to-s3', {
                hlsDir: job.hlsDir,
                label: job.label,
                filename: job.filename,
                resourceId: job.resourceId,
                bucketName,
                clientId: 'retry-' + Date.now(),
                type: job.resourceType || 'film', // Use resourceType instead of type
                initialMetadata: job.initialMetadata,
            });
        } else if (job.jobType === 'upload-master-playlist') {
            // Retry master playlist upload
            newQueueJob = await masterPlaylistQueue.add('upload-master-playlist', {
                masterPlaylistPath: job.masterPlaylistPath,
                filename: job.filename,
                resourceId: job.resourceId,
                bucketName,
                clientId: 'retry-' + Date.now(),
                type: job.resourceType || 'film', // Use resourceType instead of type
                subtitleLanguages: job.subtitleLanguages || [],
            });
        } else if (job.jobType === 'upload-subtitle-to-s3') {
            // Retry subtitle upload
            newQueueJob = await hlsUploadQueue.add('upload-subtitle-to-s3', {
                subtitlePath: job.subtitlePath,
                filename: job.filename,
                resourceId: job.resourceId,
                bucketName,
                clientId: 'retry-' + Date.now(),
                type: job.resourceType || 'film', // Use resourceType instead of type
                uploadPath: job.uploadPath,
                subtitleMetadata: job.subtitleMetadata,
            });
        } else {
            returnError('Unknown upload job type', 400);
        }

        // Create a new upload job record for the retry instead of updating the existing one
        const retryJob = await prisma.uploadJob.create({
            data: {
                jobId: newQueueJob.id.toString(),
                queueName: job.queueName || 'upload-hls-to-s3',
                jobType: job.jobType,
                status: 'waiting',
                progress: 0,
                resourceType: job.resourceType,
                resourceId: job.resourceId,
                filename: job.filename,
                uploadType: job.uploadType,
                contentType: job.contentType,
                label: job.label,
                hlsDir: job.hlsDir,
                masterPlaylistPath: job.masterPlaylistPath,
                subtitlePath: job.subtitlePath,
                uploadPath: job.uploadPath,
                subtitleMetadata: job.subtitleMetadata,
                subtitleLanguages: job.subtitleLanguages,
                initialMetadata: job.initialMetadata,
                bucketName: job.bucketName,
                clientId: 'retry-' + Date.now(),
                canCancel: true,
                // Link to the same resource
                filmId: job.filmId,
                episodeId: job.episodeId,
                seasonId: job.seasonId,
            }
        });

        // Mark the original failed job as retried
        await prisma.uploadJob.update({
            where: { id: jobId },
            data: {
                status: 'retried',
                canCancel: false,
                errorMessage: `Retried with new job ID: ${newQueueJob.id}`,
            },
        });

        console.log(`✅ Upload job ${jobId} successfully retried with new job ID: ${newQueueJob.id}`);

        res.status(200).json({
            message: 'Upload job queued for retry',
            originalJobId: jobId,
            newJobId: newQueueJob.id.toString(),
            retryJobId: retryJob.id,
        });
    } catch (error) {
        if (!error.statusCode) {
            error.statusCode = 500;
        }
        next(error);
    }
};

/**
 * @name cancelUploadJob
 * @description Cancel an upload job
 * @type {import('express').RequestHandler}
 */
export const cancelUploadJob = async (req, res, next) => {
    try {
        const { jobId } = req.params;

        if (!jobId) returnError('Job ID is required', 400);

        const job = await prisma.uploadJob.findUnique({
            where: { id: jobId },
            include: {
                film: { select: { id: true } },
                episode: {
                    select: {
                        id: true,
                        seasonId: true,
                        season: {
                            select: {
                                id: true,
                                filmId: true
                            }
                        }
                    }
                },
                season: {
                    select: {
                        id: true,
                        filmId: true
                    }
                },
            },
        });

        if (!job) returnError('Upload job not found', 404);

        if (!job.canCancel) {
            returnError('This upload job cannot be cancelled', 400);
        }

        if (['completed', 'failed', 'cancelled'].includes(job.status)) {
            returnError('Upload job is already finished', 400);
        }

        // Try to cancel/remove the BullMQ job
        try {
            let queueJob;
            if (job.jobType === 'upload-hls-to-s3') {
                queueJob = await hlsUploadQueue.getJob(job.jobId);
            } else if (job.jobType === 'upload-master-playlist') {
                queueJob = await masterPlaylistQueue.getJob(job.jobId);
            } else if (job.jobType === 'upload-subtitle-to-s3') {
                queueJob = await hlsUploadQueue.getJob(job.jobId);
            }

            if (queueJob) {
                const jobState = await queueJob.getState();

                if (jobState === 'waiting' || jobState === 'delayed') {
                    // Job hasn't started yet, we can remove it
                    await queueJob.remove();
                } else if (jobState === 'active') {
                    // Job is currently processing, we can't remove it but we can mark it as cancelled
                    console.log(`Upload job ${job.jobId} is active, marking as cancelled`);
                }
            }
        } catch (queueError) {
            console.log('Could not cancel queue job:', queueError.message);
            // Continue with database update even if queue operation fails
        }

        // Update database status
        await prisma.uploadJob.update({
            where: { id: jobId },
            data: {
                status: 'cancelled',
                cancelledAt: new Date(),
                canCancel: false,
            },
        });

        // Emit cancellation event to client
        try {
            const { resourceId } = job;
            io.to(resourceId).emit('JobCancelled', {
                message: 'Upload job was cancelled',
                jobId: job.jobId,
                clientId: resourceId
            });
        } catch (socketError) {
            console.log('Could not emit cancellation event:', socketError.message);
        }

        res.status(200).json({
            message: job.status === 'active' ? 'Upload job stop request sent successfully' : 'Upload job cancelled successfully',
        });
    } catch (error) {
        if (!error.statusCode) {
            error.statusCode = 500;
        }
        next(error);
    }
};

/**
 * @name deleteUploadJob
 * @description Delete an upload job record
 * @type {import('express').RequestHandler}
 */
export const deleteUploadJob = async (req, res, next) => {
    try {
        const { jobId } = req.params;

        if (!jobId) returnError('Job ID is required', 400);

        const job = await prisma.uploadJob.findUnique({
            where: { id: jobId },
            include: {
                film: { select: { id: true } },
                episode: {
                    select: {
                        id: true,
                        seasonId: true,
                        season: {
                            select: {
                                id: true,
                                filmId: true
                            }
                        }
                    }
                },
                season: {
                    select: {
                        id: true,
                        filmId: true
                    }
                },
            },
        });

        if (!job) returnError('Upload job not found', 404);

        // Only allow deletion of completed, failed, or cancelled jobs
        if (!['completed', 'failed', 'cancelled'].includes(job.status)) {
            returnError('Cannot delete active or waiting upload jobs. Cancel them first.', 400);
        }

        await prisma.uploadJob.delete({
            where: { id: jobId },
        });

        res.status(200).json({
            message: 'Upload job record deleted successfully',
        });
    } catch (error) {
        if (!error.statusCode) {
            error.statusCode = 500;
        }
        next(error);
    }
};

/**
 * @name clearUploadJobs
 * @description Clear all completed and failed upload job records
 * @type {import('express').RequestHandler}
 */
export const clearUploadJobs = async (req, res, next) => {
    try {
        const { status } = req.body; // 'completed', 'failed', 'cancelled', or 'all'

        let whereClause = {};

        if (status === 'all') {
            whereClause = {
                status: {
                    in: ['completed', 'failed', 'cancelled']
                }
            };
        } else if (['completed', 'failed', 'cancelled'].includes(status)) {
            whereClause = { status };
        } else {
            returnError('Invalid status. Use "completed", "failed", "cancelled", or "all"', 400);
        }

        const deletedJobs = await prisma.uploadJob.deleteMany({
            where: whereClause,
        });

        res.status(200).json({
            message: `Cleared ${deletedJobs.count} upload job records`,
            deletedCount: deletedJobs.count,
        });
    } catch (error) {
        if (!error.statusCode) {
            error.statusCode = 500;
        }
        next(error);
    }
};

/**
 * @name cleanupFailedUploadJob
 * @description Clean up failed upload job
 * @type {import('express').RequestHandler}
 */
export const cleanupFailedUploadJob = async (req, res, next) => {
    try {
        const { jobId } = req.params;

        if (!jobId) returnError('Job ID is required', 400);

        const job = await prisma.uploadJob.findUnique({
            where: { id: jobId },
            include: {
                film: { select: { id: true } },
                episode: {
                    select: {
                        id: true,
                        seasonId: true,
                        season: {
                            select: {
                                id: true,
                                filmId: true
                            }
                        }
                    }
                },
                season: {
                    select: {
                        id: true,
                        filmId: true
                    }
                },
            },
        });

        if (!job) returnError('Upload job not found', 404);

        if (job.status !== 'failed') {
            returnError('Only failed upload jobs can be cleaned up', 400);
        }

        // Clean up any temporary files if they exist
        if (job.hlsDir && fs.existsSync(job.hlsDir)) {
            try {
                fs.rmSync(job.hlsDir, { recursive: true, force: true });
                console.log(`🗑️ Cleaned up HLS directory: ${job.hlsDir}`);
            } catch (cleanupError) {
                console.warn(`⚠️ Could not clean up HLS directory ${job.hlsDir}:`, cleanupError.message);
            }
        }

        if (job.masterPlaylistPath && fs.existsSync(job.masterPlaylistPath)) {
            try {
                fs.unlinkSync(job.masterPlaylistPath);
                console.log(`🗑️ Cleaned up master playlist: ${job.masterPlaylistPath}`);
            } catch (cleanupError) {
                console.warn(`⚠️ Could not clean up master playlist ${job.masterPlaylistPath}:`, cleanupError.message);
            }
        }

        if (job.subtitlePath && fs.existsSync(job.subtitlePath)) {
            try {
                fs.unlinkSync(job.subtitlePath);
                console.log(`🗑️ Cleaned up subtitle file: ${job.subtitlePath}`);
            } catch (cleanupError) {
                console.warn(`⚠️ Could not clean up subtitle file ${job.subtitlePath}:`, cleanupError.message);
            }
        }

        res.status(200).json({
            message: 'Upload job cleaned up successfully',
        });
    } catch (error) {
        if (!error.statusCode) {
            error.statusCode = 500;
        }
        next(error);
    }
};

/**
 * @name syncUploadJobStatus
 * @description Sync upload job status with BullMQ queue state
 * @type {import('express').RequestHandler}
 */
export const syncUploadJobStatus = async (req, res, next) => {
    try {
        const { jobId } = req.params;

        if (!jobId) returnError('Job ID is required', 400);

        const job = await prisma.uploadJob.findUnique({
            where: { id: jobId },
            include: {
                film: { select: { id: true } },
                episode: {
                    select: {
                        id: true,
                        seasonId: true,
                        season: {
                            select: {
                                id: true,
                                filmId: true
                            }
                        }
                    }
                },
                season: {
                    select: {
                        id: true,
                        filmId: true
                    }
                },
            },
        });

        if (!job) returnError('Upload job not found', 404);

        // Get BullMQ job details
        let queueJobDetails = null;
        try {
            let queueJob;
            if (job.jobType === 'upload-hls-to-s3') {
                queueJob = await hlsUploadQueue.getJob(job.jobId);
            } else if (job.jobType === 'upload-master-playlist') {
                queueJob = await masterPlaylistQueue.getJob(job.jobId);
            } else if (job.jobType === 'upload-subtitle-to-s3') {
                queueJob = await hlsUploadQueue.getJob(job.jobId);
            }

            if (queueJob) {
                const jobState = await queueJob.getState();
                queueJobDetails = {
                    progress: queueJob.progress,
                    state: jobState,
                    processedOn: queueJob.processedOn,
                    finishedOn: queueJob.finishedOn,
                    failedReason: queueJob.failedReason,
                };

                // Sync status based on queue state
                let newStatus = job.status;
                if (jobState === 'active' && job.status === 'waiting') {
                    newStatus = 'active';
                } else if (jobState === 'completed' && job.status !== 'completed') {
                    newStatus = 'completed';
                } else if (jobState === 'failed' && job.status !== 'failed') {
                    newStatus = 'failed';
                }

                if (newStatus !== job.status) {
                    await prisma.uploadJob.update({
                        where: { id: jobId },
                        data: {
                            status: newStatus,
                            progress: jobState === 'completed' ? 100 : job.progress,
                            failedReason: jobState === 'failed' ? queueJob.failedReason : job.failedReason,
                        },
                    });
                }
            }
        } catch (queueError) {
            console.log('Could not fetch queue job details:', queueError.message);
        }

        res.status(200).json({
            message: 'Upload job status synced successfully',
            job: {
                ...job,
                queueDetails: queueJobDetails,
            },
        });
    } catch (error) {
        if (!error.statusCode) {
            error.statusCode = 500;
        }
        next(error);
    }
};

/**
 * @name fixStuckUploadJobs
 * @description Fix upload jobs that are stuck in waiting state but actually processing
 * @type {import('express').RequestHandler}
 */
export const fixStuckUploadJobs = async (req, res, next) => {
    try {
        console.log('🔧 Fixing stuck upload jobs...');

        // Get all stuck upload jobs (active for more than 2 hours)
        const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);

        const stuckJobs = await prisma.uploadJob.findMany({
            where: {
                status: 'active',
                updatedAt: {
                    lt: twoHoursAgo
                }
            }
        });

        console.log(`🔧 Found ${stuckJobs.length} stuck upload jobs`);

        let fixedCount = 0;
        for (const job of stuckJobs) {
            try {
                // Check if the job actually exists in the queue
                let queueJob;
                if (job.jobType === 'upload-hls-to-s3') {
                    queueJob = await hlsUploadQueue.getJob(job.jobId);
                } else if (job.jobType === 'upload-master-playlist') {
                    queueJob = await masterPlaylistQueue.getJob(job.jobId);
                } else if (job.jobType === 'upload-subtitle-to-s3') {
                    queueJob = await hlsUploadQueue.getJob(job.jobId);
                }

                if (!queueJob) {
                    // Job doesn't exist in queue, mark as failed
                    await prisma.uploadJob.update({
                        where: { id: job.id },
                        data: {
                            status: 'failed',
                            failedReason: 'Upload job not found in queue - marked as stuck',
                            canCancel: false
                        }
                    });
                    fixedCount++;
                    console.log(`🔧 Fixed stuck upload job ${job.jobId} - marked as failed`);
                } else {
                    // Job exists in queue, check its state
                    const jobState = await queueJob.getState();

                    if (jobState === 'failed' || jobState === 'completed') {
                        // Update database to match queue state
                        await prisma.uploadJob.update({
                            where: { id: job.id },
                            data: {
                                status: jobState === 'failed' ? 'failed' : 'completed',
                                failedReason: jobState === 'failed' ? 'Upload job failed in queue' : null,
                                canCancel: false
                            }
                        });
                        fixedCount++;
                        console.log(`🔧 Fixed stuck upload job ${job.jobId} - synced with queue state: ${jobState}`);
                    }
                }
            } catch (error) {
                console.error(`🔧 Error fixing upload job ${job.jobId}:`, error.message);
            }
        }

        res.status(200).json({
            success: true,
            message: `Fixed ${fixedCount} stuck upload jobs out of ${stuckJobs.length} found`,
            fixedCount,
            totalFound: stuckJobs.length
        });

    } catch (error) {
        console.error('🔧 Error fixing stuck upload jobs:', error);
        return returnError(res, 500, 'Failed to fix stuck upload jobs');
    }
};
