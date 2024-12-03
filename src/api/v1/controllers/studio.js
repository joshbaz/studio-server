import prisma from '@/utils/db.mjs';
import { returnError } from '@/utils/returnError.js';
import { deleteFromBucket, uploadToBucket } from '@/services/s3.js';

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

//Films
/**
 *
 * @name getFilms
 * @description Get all films
 * @type {import('express').RequestHandler}
 */
export const getFilms = async (req, res, next) => {
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
                video: {
                    include: {
                        purchase: {
                            include: {
                                transaction: true,
                            },
                        },
                    },
                },
                views: true,
                season: {
                    include: {
                        episodes: {
                            include: {
                                video: {
                                    include: {
                                        videoPrice: true,
                                    },
                                },
                            },
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

        // get the total donation amount for the film
        const totalDonation = film.donation.reduce((acc, donation) => {
            if (donation.transaction.status === 'SUCCESS') {
                acc += donation.transaction.amount;
            }
            return acc;
        }, 0);

        let purchaseAmount = {};
        if (film.access === 'rent') {
            // get the total purchase per video resolution
            purchaseAmount = film.video.reduce((acc, video) => {
                if (video.purchase.length > 0) {
                    for (let purchase of video.purchase) {
                        if (purchase.transaction.status === 'SUCCESS') {
                            if (acc[video.resolution]) {
                                acc[video.resolution] +=
                                    purchase.transaction.amount;
                            } else {
                                acc[video.resolution] =
                                    purchase.transaction.amount;
                            }
                        }
                    }
                }
                return acc;
            }, {});
        }

        if (!film) returnError('Film not found', 404);

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
        const { isCover, isBackdrop } = req.body;

        if (!filmId) returnError('FilmID is required', 400);

        const film = await prisma.film.findUnique({
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

        // open SSE connection
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        const data = await uploadToBucket(res, bucketParams);

        const posterData = {
            url: data.url,
            name: poster.originalname,
            type: poster.mimetype,
            isCover: isCover === 'true' ? true : false,
            isBackdrop: isBackdrop === 'true' ? true : false,
            filmId,
        };

        // create a new poster
        const newPoster = await prisma.poster.create({
            data: posterData,
        });

        res.write(
            `data: ${JSON.stringify({
                message: 'Upload complete',
                poster: newPoster,
            })}\n\n`
        );

        res.end();
    } catch (error) {
        if (!error.statusCode) {
            error.statusCode = 500;
        }
        res.write(`data: ${JSON.stringify({ message: error.message })}\n\n`);
        res.end();
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

        // bucket name: filmid-seasonid/<postername>
        const bucketParams = {
            bucketName: `${episode.season.filmId}-${episode.seasonId}`,
            key: poster.originalname,
            buffer: poster.buffer,
            contentType: poster.mimetype,
            isPublic: true,
        };

        // open SSE connection
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        const data = await uploadToBucket(res, bucketParams);

        const posterData = {
            url: data.url,
            name: poster.originalname,
            type: poster.mimetype,
            isCover: isCover === 'true' ? true : false,
            isBackdrop: isBackdrop === 'true' ? true : false,
            filmId,
        };

        // create a new poster
        const newPoster = await prisma.poster.create({
            data: posterData,
        });

        res.write(
            `${JSON.stringify({
                message: 'Upload complete',
                poster: newPoster,
            })}`
        );

        res.end();
    } catch (error) {
        if (!error.statusCode) {
            error.statusCode = 500;
        }
        res.write(`data: ${JSON.stringify({ message: error.message })}\n\n`);
        res.end();
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
                    bucketName: `${episode.season.filmId}-${episode.seasonId}`,
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

        const film = await prisma.film.findUnique({
            where: {
                id: filmId,
            },
        });

        if (!film) returnError('Film not found', 404);

        const updated = await prisma.film.update({
            where: { id: filmId },
            data: {
                ...req.data,
                releaseDate: new Date(req.data.releaseDate),
                updatedAt: new Date(),
            },
        });

        res.status(200).json({
            message: 'Film updated successfully',
            film: updated,
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

// Video Uploads
// film (type: movie)
/**
 * @name uploadFilm film to bucket
 * @description function to upload film to bucket and get signed url
 * @type {import('express').RequestHandler}
 */
export const uploadFilm = async (req, res) => {
    try {
        const { filmId } = req.params;

        if (!filmId) returnError('Film ID is required', 400);

        const film = await prisma.film.findUnique({
            where: { id: filmId },
        });

        if (!film) returnError('Film not found', 404);

        const file = req.file;
        if (!file) returnError('No file uploaded', 400);

        const { isTrailer, resolution, price, currency } = req.body;

        if (!resolution) {
            returnError('Resolution is required', 400);
        }

        if (!currency || !price) {
            returnError('Price and currency are required', 400);
        }

        const headers = {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
        };

        // open SSE connection
        res.writeHead(200, headers);

        const filename = `${resolution}-${file.originalname.replace(
            /\s/g,
            '-'
        )}`.toLowerCase(); // replace spaces with hyphens

        const bucketParams = {
            bucketName: filmId,
            key: filename,
            buffer: file.buffer,
            contentType: file.mimetype,
            isPublic: true,
        };

        const data = await uploadToBucket(res, bucketParams);
        const videoData = {
            url: data.url,
            format: file.mimetype,
            name: filename, // used as the key in the bucket
            size: formatFileSize(file.size),
            encoding: file.encoding,
            isTrailer,
            filmId,
            resolution, // SD, HD, FHD, UHD
        };

        // create a video record with all the details including the signed url
        const newVideo = await prisma.video.create({
            data: videoData,
        });

        if (price && currency && newVideo.id) {
            // add a new entry to the video pricing table
            const formattedPrice =
                typeof price === 'string' ? parseFloat(price) : price;
            await prisma.videoPrice.create({
                data: {
                    currency,
                    price: formattedPrice,
                    videoId: newVideo.id,
                },
            });
        }

        res.write(
            `data: ${JSON.stringify({
                message: 'Upload complete',
                video: newVideo,
            })}\n\n`
        );

        res.end();

        // return success message
    } catch (error) {
        if (!error.statusCode) {
            error.statusCode = 500;
        }
        res.write(`data: ${JSON.stringify({ message: error.message })}\n\n`);
        res.end();
    }
};

/**
 * @name uploadEpisode film to bucket
 * @description function to upload film to bucket and get signed url
 * @type {import('express').RequestHandler}
 */
export const uploadEpisode = async (req, res, next) => {
    try {
        const { episodeId } = req.params;

        if (!episodeId) returnError('Episode ID is required', 400);

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

        const file = req.file;
        if (!file) returnError('No file uploaded', 400);

        const { isTrailer, resolution, price, currency } = req.body;

        if (!resolution) {
            returnError('Resolution is required', 400);
        }

        if (!currency || !price) {
            returnError('Price and currency are required', 400);
        }

        // open SSE connection
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        const filename = `${resolution}-${file.originalname.replace(
            /\s/g,
            '-'
        )}`.toLowerCase(); // replace spaces with hyphens

        const bucketParams = {
            bucketName: `${episode.season.filmId}-${episode.seasonId}`,
            key: filename,
            buffer: file.buffer,
            contentType: file.mimetype,
            isPublic: true,
        };

        const data = await uploadToBucket(res, bucketParams);
        const videoData = {
            url: data.url,
            format: file.mimetype,
            name: filename, // used as the key in the bucket
            size: formatFileSize(file.size),
            encoding: file.encoding,
            isTrailer,
            episodeId,
            resolution, // SD, HD, FHD, UHD
        };

        // create a video record with all the details including the signed url
        const newVideo = await prisma.video.create({
            data: videoData,
        });

        if (price && currency && newVideo.id) {
            // add a new entry to the video pricing table
            const formattedPrice =
                typeof price === 'string' ? parseFloat(price) : price;
            await prisma.videoPrice.create({
                data: {
                    currency,
                    videoId: newVideo.id,
                    price: formattedPrice,
                },
            });
        }

        res.write(
            `${JSON.stringify({
                message: 'Upload complete',
                video: newVideo,
            })}`
        );

        res.end();
    } catch (error) {
        if (!error.statusCode) {
            error.statusCode = 500;
        }
        res.write(`${JSON.stringify({ message: error.message })}`);
        res.end();
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
            where: {
                OR: [
                    {
                        status: {
                            contains: 'success',
                        },
                    },
                    {
                        status: {
                            contains: 'pending',
                        },
                    },
                ],
            },
        });
        const webDonations = await prisma.webDonation.findMany({
            where: {
                OR: [
                    {
                        payment_status_description: {
                            contains: 'success',
                        },
                    },
                    {
                        payment_status_description: {
                            contains: 'pending',
                        },
                    },
                ],
            },
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
 * @name updateVideoPrice
 * @description function to get film pricing
 * @type {import('express').RequestHandler}
 */

export const updateVideoPrice = async (req, res, next) => {
    try {
        const { videoId } = req.params;
        const { price, currency } = req.body;

        if (!price || !currency) {
            returnError('Price and currency are required', 400);
        }

        const formattedPrice =
            typeof price === 'string' ? parseFloat(price) : price;

        const updatedPrice = await prisma.videoPrice.update({
            where: { videoId },
            data: { price: formattedPrice, currency },
        });

        res.status(200).json({
            message: 'Price updated successfully',
            price: updatedPrice,
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
                status: { contains: 'success' },
                type: 'PURCHASE',
            },
            include: {
                user: {
                    select: {
                        id: true,
                        firstName: true,
                        lastName: true,
                        email: true,
                    },
                },
            },
        });

        const totalAmount = transactions.reduce((acc, transaction) => {
            acc += transaction.amount;
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
