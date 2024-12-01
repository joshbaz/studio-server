import prisma from '@/utils/db.mjs';
import { returnError } from '@/utils/returnError.js';
import { deleteFromBucket } from '@/utils/video.mjs';

// utils
/**
 * @name checkUploadPermission
 * @description function to check upload permission
 * @param {Express.Request} req
 * @param {Express.Response} res
 * @param {String} adminId
 * @returns  {Promise<File>}
 */

async function checkUploadPermission(req, res) {
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
                video: true,
                views: true,
                season: {
                    include: {
                        episodes: {
                            include: {
                                video: true,
                            },
                        },
                    },
                },
            },
        });

        if (!film) returnError('Film not found', 404);

        return res.status(200).json({ film });
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
                    },
                },
                film: true,
            },
        });

        if (!season) returnError('Season not found', 404);

        // series bucket name: filmId/seasonId/<vidoename>
        for (let episode of season.episodes) {
            if (episode.video.length > 0) {
                for (let video of episode.video) {
                    await deleteFromBucket({
                        bucketName: `${season.filmId}-${seasonId}`,
                        key: video.name,
                    });
                }
            }
        }

        await prisma.season.delete({
            where: { id: season.id },
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

        console.log('Request.data', req.data);

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

        const videos = await prisma.video.findMany({
            where: { filmId },
        });

        if (videos && videos.length > 0) {
            for (let video of videos) {
                await deleteFromBucket({ bucketName: filmId, key: video.name });
            }
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
        next(error);
    }
};

// Video Uploads
// film (type: movie)
/**
/**
 * @name upload film to bucket
 * @description function to upload film to bucket and get signed url
 * @type {import('express').RequestHandler}
 */
export const uploadVideo = async (req, res, next) => {
    try {
        const { filmId } = req.params;
        const { isTrailer, resolution, price, currency } = req.body;

        if (!resolution) {
            returnError('Resolution is required', 400);
        }

        if (!currency || !price) {
            returnError('Price and currency are required', 400);
        }

        const { file } = await checkUploadPermission(req, res);

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

        const data = await uploadToBucket(bucketParams);
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

        // return success message
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
