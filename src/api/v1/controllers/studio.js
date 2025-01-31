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
                video: {
                    include: {
                        purchase: {
                            include: {
                                transaction: true,
                            },
                        },
                        videoPrice: true,
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
                                posters: true,
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

        if (!film) returnError('Film not found', 404);
        // get the total donation amount for the film
        let totalDonation = 0;

        console.log(film?.donation);
        if (film?.donation.length > 0) {
            totalDonation = film.donation.reduce((acc, donation) => {
                if (donation.transaction.status === 'SUCCESS') {
                    acc += donation.transaction.amount;
                }
                return acc;
            }, 0);
        }

        let purchaseAmount = {};
        if (film?.access === 'rent') {
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

        const posterData = {
            url: poster.originalname,
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

        const bucketParams = {
            bucketName: filmId,
            key: poster.originalname,
            buffer: poster.buffer,
            contentType: poster.mimetype,
            isPublic: true,
        };

        const data = await uploadToBucket(bucketParams);

        await prisma.poster.update({
            where: { id: newPoster.id },
            data: { url: data.url },
        });

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

        const posterData = {
            url: poster.originalname,
            name: poster.originalname,
            type: poster.mimetype,
            isCover: isCover === 'true' ? true : false,
            isBackdrop: isBackdrop === 'true' ? true : false,
            episodeId,
        };

        // create a new poster
        const newPoster = await prisma.poster.create({
            data: posterData,
        });

        // bucket name: filmid-seasonid/<postername>
        const bucketParams = {
            bucketName: `${episode.season.filmId}-${episode.seasonId}`,
            key: poster.originalname,
            buffer: poster.buffer,
            contentType: poster.mimetype,
            isPublic: true,
        };

        const data = await uploadToBucket(bucketParams);

        await prisma.poster.update({
            where: { id: newPoster.id },
            data: {
                url: data.url,
            },
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
        console.log(req.data);
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

        const { resolution, price, currency } = req.body;

        if (!resolution) {
            returnError('Resolution is required', 400);
        }

        if (!currency || !price) {
            returnError('Price and currency are required', 400);
        }

        const filename = `${resolution}-${file.originalname.replace(
            /\s/g,
            '-'
        )}`.toLowerCase(); // replace spaces with hyphens

        // check if we have a video with the same name in the bucket
        const videoExists = await prisma.video.findFirst({
            where: { name: filename },
        });

        if (videoExists) {
            returnError('A video with the same name already exists', 400);
        }

        // create a video record with all the details including the signed url
        const videoData = {
            filmId,
            resolution, // SD, HD, FHD, UHD
            name: filename, // used as the key in the bucket
            format: file.mimetype,
            url: file.originalname,
            encoding: file.encoding,
            size: formatFileSize(file.size),
        };

        const newVideo = await prisma.video.create({
            data: videoData,
        });

        const bucketParams = {
            bucketName: filmId,
            key: filename,
            buffer: file.buffer,
            contentType: file.mimetype,
            isPublic: true,
        };

        const data = await uploadToBucket(bucketParams);

        await prisma.video.update({
            where: { id: newVideo.id },
            data: { url: data.url },
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
        const { id } = req.params;

        if (!id) returnError('Film id or episode ID is required', 400);

        const body = req.body;

        if (!body.type) {
            returnError('Either type "film" or "episode" is required', 400);
        }

        let resource = null;

        if (body.type === 'film') {
            resource = await prisma.film.findUnique({
                where: { id },
            });
        }

        if (body.type === 'episode') {
            resource = await prisma.episode.findUnique({
                where: { id },
                include: {
                    season: {
                        select: { id: true, filmId: true },
                    },
                },
            });
        }

        if (!resource) returnError('Film or episode was not found', 404);

        const file = req.file;
        if (!file) returnError('No file uploaded', 400);

        const filename = `trailer-${file.originalname.replace(
            /\s/g,
            '-'
        )}`.toLowerCase(); // replace spaces with hyphens

        // check if we have a video with the same name in the bucket
        const videoExists = await prisma.video.findFirst({
            where: { name: filename },
        });

        if (videoExists) {
            returnError('A video with the same name already exists', 400);
        }

        const videoData = {
            url: file.originalname,
            format: file.mimetype,
            name: filename, // used as the key in the bucket
            size: formatFileSize(file.size),
            encoding: file.encoding,
            isTrailer: true,
        };

        if (body?.type === 'film') {
            videoData.filmId = id;
        } else if (body?.type === 'season') {
            videoData.seasonId = id;
        } else {
            videoData.episodeId = id;
        }

        // create a video record with all the details including the signed url
        const newVideo = await prisma.video.create({
            data: videoData,
        });

        let bucketName = id;

        switch (body?.type) {
            case 'film':
                bucketName = id;
                break;
            case 'season':
                bucketName = `${resource.filmId}-${resource.seasonId}`;
                break;
            case 'episode':
                bucketName = `${resource.season.filmId}-${resource.seasonId}`;
                break;
        }

        const bucketParams = {
            bucketName: bucketName,
            key: filename,
            buffer: file.buffer,
            contentType: file.mimetype,
            isPublic: true,
        };

        const data = await uploadToBucket(bucketParams);

        await prisma.video.update({
            where: { id: newVideo.id },
            data: { url: data.url },
        });

        res.status(200).json({
            message: 'Trailer uploaded.',
        });
    } catch (error) {
        if (!error.statusCode) {
            error.statusCode = 500;
        }
        next(error);
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

        const filename = `${resolution}-${file.originalname.replace(
            /\s/g,
            '-'
        )}`.toLowerCase(); // replace spaces with hyphens

        // check if we have a video with the same name in the bucket
        const videoExists = await prisma.video.findFirst({
            where: { name: filename },
        });

        if (videoExists) {
            returnError('A video with the same name already exists', 400);
        }

        const videoData = {
            url: file.originalname,
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

        const bucketParams = {
            bucketName: `${episode.season.filmId}-${episode.seasonId}`,
            key: filename,
            buffer: file.buffer,
            contentType: file.mimetype,
            isPublic: true,
        };

        const data = await uploadToBucket(bucketParams);

        await prisma.video.update({
            where: { id: newVideo.id },
            data: { url: data.url },
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

        res.status(200).json({ message: 'Upload complete' });
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
                status: {
                    in: ['SUCCESS', 'PENDING'],
                },
                type: 'PURCHASE',
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
