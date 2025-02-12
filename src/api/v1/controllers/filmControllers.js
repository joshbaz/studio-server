import { GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { s3Client } from '@/services/s3.js';
import prisma from '@/utils/db.mjs';
import { returnError } from '@/utils/returnError.js';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { env } from '@/env.mjs';
import { checkPaymentStatus as checkMtnStatus } from '@/services/mtnpayments.js';
import { addDays } from 'date-fns';
import { resSelector } from '@/utils/resSelector.js';

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
    try {
        // Validate range
        if (!range) {
            returnError('Range header is required', 416);
        }

        // Create stream parameters
        const streamParams = { Bucket: bucketName, Key: key };

        // Get metadata for the object
        const data = await s3Client.send(new HeadObjectCommand(streamParams));
        const { ContentLength, ContentType } = data;

        // Parse range
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : ContentLength - 1;

        if (
            isNaN(start) ||
            isNaN(end) ||
            start >= ContentLength ||
            end >= ContentLength ||
            start > end
        ) {
            returnError("Requested range can't be satisfied", 416);
        }

        const chunkSize = end - start + 1;

        // Set headers
        const headers = {
            'Content-Range': `bytes ${start}-${end}/${ContentLength}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': chunkSize,
            'Content-Type': ContentType,
        };

        // Send headers
        res.writeHead(206, headers);

        // Fetch the chunk and pipe to response
        const streamData = await s3Client.send(
            new GetObjectCommand({
                ...streamParams,
                Range: `bytes=${start}-${end}`,
            })
        );

        return streamData;
    } catch (err) {
        throw err;
    }
};

/**
 * @name streamFilm
 * @description function to stream film from bucket to client
 * @type {import('express').RequestHandler}
 */
export const streamFilm = async (req, res, next) => {
    try {
        const { trackId } = req.params;

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
                    select: { id: true },
                },
            },
        });

        if (!video.id) {
            returnError('Video not found', 404);
        }

        const videoParams = {
            key: video.name,
            bucketName: video.film.id,
            range: req.headers.range,
        };

        const stream = await streamVideo(videoParams, res);
        stream.Body.pipe(res);
    } catch (error) {
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
                video: true,
                season: {
                    include: {
                        posters: true,
                        episodes: true,
                    },
                },
            },
        };

        // get the donation only films
        if (query.donation) {
            options = {
                where: { enableDonation: true },
                include: {
                    ...options.include,
                    donation: {
                        include: {
                            transaction: true,
                        },
                    },
                },
            };
        }

        const films = await prisma.film.findMany({
            include: { posters: true },
        });

        res.status(200).json({ films });
    } catch (error) {
        if (!error.statusCode) {
            error.statusCode = 500;
        }
        next(error);
    }
};

/**
 * @name fetchFilm
 * @description function to fetch a film by id
 * @type {import('express').RequestHandler}
 */
export const fetchFilm = async (req, res, next) => {
    try {
        const { filmId } = req.params;
        if (!filmId) {
            returnError('No film id provided', 400);
        }

        const film = await prisma.film.findUnique({
            where: { id: filmId },
            include: {
                posters: true,
                pricing: {
                    include: { priceList: true },
                },
                purchase: true,
                video: true,
                season: {
                    include: {
                        likes: { where: { userId: req.userId } },
                        episodes: {
                            include: {
                                posters: true,
                                video: true,
                            },
                        },
                    },
                },
                watchlist: {
                    where: { userId: req.userId, filmId },
                    select: {
                        id: true,
                        filmId: true,
                        type: true,
                        userId: true,
                    },
                },
                likes: {
                    where: { userId: req.userId, filmId },
                },
                views: true,
            },
        });

        // confirm if the film has a purchase and it has expired
        if (film.purchase && film.purchase.expiresAt < new Date()) {
            await prisma.purchase.update({
                where: { id: film.purchase.id, userId: req.userId },
                data: { valid: false },
            });
        }

        if (!film) returnError('Film not found', 404);

        res.status(200).json({ film });
    } catch (error) {
        if (!error.statusCode) {
            error.statusCode = 500;
        }

        next(error);
    }
};

/**
 * @name fetchSeason
 * @description function to fetch a season by id
 * @type {import('express').RequestHandler}
 */
export const fetchSeason = async (req, res, next) => {
    try {
        const { userId } = req.userId;
        const { seasonId } = req.params;
        if (!seasonId) returnError('Season ID is required', 400);

        const season = await prisma.season.findUnique({
            where: { id: seasonId },
            include: {
                film: true,
                posters: true,
                trailers: true,
                purchase: { where: { userId } },
                pricing: {
                    include: { priceList: true },
                },
                likes: { where: { userId } },
                episodes: {
                    orderBy: { episode: 'asc' },
                    include: {
                        posters: true,
                        video: true,
                    },
                },
            },
        });

        // confirm if the season has a purchase and it has expired
        if (season.purchase && season.purchase?.expiresAt < new Date()) {
            await prisma.purchase.update({
                where: { id: season.purchase.id, userId },
                data: { valid: false },
            });
        }

        res.status(200).json({ season });
    } catch (error) {
        if (!error.statusCode) {
            error.statusCode = 500;
        }

        next(error);
    }
};
/**
 * @name fetchSeasons
 * @description function to fetch all seasons
 * @type {import('express').RequestHandler}
 */
export const fetchSeasons = async (_, res, next) => {
    try {
        const seasons = await prisma.season.findMany({
            include: {
                film: true,
                posters: true,
                likes: true,
            },
        });

        res.status(200).json({ seasons });
    } catch (error) {
        if (!error.statusCode) {
            error.statusCode = 500;
        }

        next(error);
    }
};

/**
 * @name fetchEpisode
 * @description function to fetch episode
 * @type {import('express').RequestHandler} Express request handler
 */
export const fetchEpisode = async (req, res, next) => {
    try {
        const { episodeId } = req.params;
        const episode = await prisma.episode.findUnique({
            where: { id: episodeId },
            include: {
                video: true,
                posters: true,
            },
        });

        res.status(200).json({ episode });
    } catch (error) {
        if (!error.statusCode) {
            error.statusCode = 500;
        }
        next(error);
    }
};

/**
 *
 * @name getPurchasedFilms
 * @description function to fetch similar films
 * @type {import('express').RequestHandler}
 */
export const getPurchasedFilms = async (req, res, next) => {
    try {
        const { userId } = req.params;
        if (!userId) {
            returnError('No user id provided', 400);
        }

        const films = await prisma.purchase.findMany({
            where: { userId, status: 'SUCCESS' },
            include: {
                video: {
                    include: {
                        film: {
                            include: {
                                posters: true,
                            },
                        },
                    },
                },
            },
        });

        res.status(200).json({ films: films ? films : [] });
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
 * @name addWatchList - Add to the watchlist
 * @description function to add a film to the watchlist
 * @type {import('express').RequestHandler}
 */
export const addWatchList = async (req, res, next) => {
    try {
        const { type, userId, resourceId } = req.data; // film or season

        if (!resourceId || !userId) {
            returnError('Unauthorized', 401);
        }

        const resourceField = type === 'film' ? 'filmId' : 'seasonId';

        let resource = null;

        switch (type) {
            case 'film':
                resource = await prisma.film.findUnique({
                    where: { id: resourceId },
                });
                break;
            case 'season':
                resource = await prisma.season.findUnique({
                    where: { id: resourceId },
                });

                break;
            default:
                returnError('Invalid type', 400);
        }

        if (!resource) returnError(`${type} not found`, 404);

        // find if the film is in the watchlist
        const resourceExists = await prisma.watchlist.findFirst({
            where: {
                [resourceField]: resourceId,
                userId,
            },
        });

        if (!resourceExists) {
            await prisma.watchlist.create({
                data: {
                    userId,
                    [resourceField]: resourceId,
                },
            });
            return res.status(200).json({ message: 'Added to watchlist' });
        } else {
            // remove the film from the watchlist
            await prisma.watchlist.delete({
                where: {
                    id: resourceExists.id,
                },
            });
            return res.status(200).json({ message: 'Removed from watchlist' });
        }
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
                season: {
                    select: {
                        id: true,
                        title: true,
                        posters: true,
                        film: { select: { type: true } },
                    },
                },
            },
            take: limit ? parseInt(limit) : 20, // default limit is 20
        });

        // format the watchlist to only show the id and some film details
        if (watchlist?.length > 0) {
            watchlist = watchlist.reduce((acc, curr) => {
                console.log(curr);
                if (!acc[curr.type]) {
                    acc[curr.type] = [];
                }

                if (curr.film) {
                    const film = {
                        id: curr.film.id,
                        title: curr.film.title,
                        releaseDate: curr.film.releaseDate,
                        poster: curr.film?.posters[0] ?? null,
                        type: curr.film.type,
                    };
                    acc[curr.type].push(film);
                }

                if (curr.season) {
                    const season = {
                        id: curr.season.id,
                        title: curr.season.title,
                        poster: curr.season?.posters[0] ?? null,
                        type: 'season',
                    };

                    acc[curr.type].push(season);
                }

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
 * @name likeRateFilm - like or dislike a film
 * @description function to like or dislike a film
 * @type {import('express').RequestHandler}
 */
export const likeRateFilm = async (req, res, next) => {
    try {
        const { type, likeType, userId, resourceId } = req.data; // { likeType: "THUMBS_UP" or "THUMBS_DOWN" or "NONE", type: "film" or "season" }

        if (!resourceId || !userId) {
            returnError('Unauthorized', 401);
        }

        switch (type) {
            case 'film':
                const filmExists = await prisma.film.findUnique({
                    where: { id: resourceId },
                });

                if (!filmExists) returnError('Film was not found', 404);

                const likeExists = await prisma.likes.findFirst({
                    where: { filmId: resourceId, userId },
                });

                if (likeExists) {
                    // change the like status to the selected status
                    await prisma.likes.update({
                        where: { id: likeExists.id },
                        data: { type: likeType }, //"THUMBS_UP" or "THUMBS_DOWN" or "NONE",
                    });
                } else {
                    await prisma.likes.create({
                        data: {
                            userId,
                            type: likeType,
                            filmId: resourceId,
                        },
                    });
                }
                break;
            case 'season':
                const seasonExists = await prisma.likes.findFirst({
                    where: {
                        userId,
                        seasonId: resourceId,
                    },
                });
                if (seasonExists) {
                    // change the like status to the selected status
                    await prisma.likes.update({
                        where: { id: seasonExists.id },
                        data: { type: likeType }, //"THUMBS_UP" or "THUMBS_DOWN" or "NONE",
                    });
                } else {
                    await prisma.likes.create({
                        data: {
                            userId,
                            seasonId: resourceId,
                            type: likeType, // "THUMBS_UP" or "THUMBS_DOWN" or "NONE"
                        },
                    });
                }
                break;
            default:
                returnError('Invalid type', 400);
        }

        res.status(200).json({ message: 'ok' });
    } catch (error) {
        if (!error.statusCode) {
            error.statusCode = 500;
        }
        next(error);
    }
};

/**
 * @name getFilmBySearch
 * @description function to search for a film
 * @type {import('express').RequestHandler}
 */
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
 * @name purchaseFilm
 * @description function to purchase a film
 * @type {import('express').RequestHandler}
 */
export const purchaseFilm = async (req, res, next) => {
    try {
        const {
            type,
            userId,
            option,
            resourceId,
            resolution,
            resourceType,
            paymentNumber,
            paymentMethodId,
        } = req.data;

        if (!userId || !resourceId || !resourceType) {
            returnError('Unauthorized purchase', 401);
        }

        let resource = null;

        if (resourceType === 'film') {
            resource = await prisma.film.findUnique({
                where: { id: resourceId },
                include: { pricing: { include: { priceList: true } } },
            });
        }

        if (resourceType === 'season') {
            resource = await prisma.season.findUnique({
                where: { id: resourceId },
                include: { pricing: { include: { priceList: true } } },
            });
        }

        if (!resource) returnError('Could not find film or season', 404);

        // get the pricing for the resolution that was sent
        const priceItem = resource.pricing.priceList.find(
            (price) => price.resolution === resolution
        );

        // const video = await prisma.video.findUnique({
        //     where: { id: videoId },
        //     include: {
        //         videoPrice: true,
        //         film: true,
        //     },
        // });

        // if (!video) returnError('The resource can not be found.', 404);
        // if (!option) returnError('Payment method is required', 400);

        //  const PAYMENTS_API = env.NYATI_PAYMENTS_API_URL;
        let createdUUIDs = uuidv4(new Date());
        // let amounts = video?.videoPrice.price.toString();
        let amounts = priceItem.price.toString();
        // const phoneNumbers =
        //     body.phoneCode.replace('+', '') + body.paymentNumber;
        const phoneNumber = paymentNumber.replace('+', '');

        const resourceField = resourceType === 'film' ? 'filmId' : 'seasonId';

        // switch by payment type
        // switch (body.option) {
        switch (option) {
            case 'mtnmomo':
                try {
                    let TargetEnvs = 'mtnuganda';
                    let subscription_Keys = 'fedc2d49cbdb42328a2e94e846818ab8';
                    let currencys = 'UGX';
                    let MTNRequestLinks = `https://proxy.momoapi.mtn.com/collection/v1_0/requesttopay`;
                    // let callbackURL = "https://api.nyatimotionpictures.com/api/v1/payment/mtn/callback/web"

                    let requestParameters = {
                        amount: amounts,
                        currency: currencys,
                        externalId: createdUUIDs,
                        payer: {
                            partyIdType: 'MSISDN',
                            // partyId: phoneNumbers,
                            partyId: phoneNumber,
                        },
                        payerMessage: `Purchase Film `,
                        payeeNote: '',
                    };

                    // console.log("requestParameters", requestParameters)

                    let headers = {
                        'Content-Type': 'application/json',
                        Authorization: req.mtn_access_token,
                        'X-Callback-Url': `https://api.nyatimotionpictures.com/api/v1/film/checkpaymentstatus/${createdUUIDs}`,
                        'X-Reference-Id': `${createdUUIDs}`,
                        'X-Target-Environment': TargetEnvs,
                        'Ocp-Apim-Subscription-Key': subscription_Keys,
                    };

                    //  console.log("requestParameters", headers)

                    let submitOrderRequest = await axios.post(
                        MTNRequestLinks,
                        requestParameters,
                        {
                            headers: headers,
                        }
                    );

                    console.log(
                        'submitOrderRequest',
                        submitOrderRequest.statusText
                    );

                    if (submitOrderRequest.statusText !== 'Accepted') {
                        returnError('Payment Processing failed', 400);
                    }

                    // Save the transaction including the orderTrackingId
                    const transaction = await prisma.transaction.create({
                        data: {
                            userId,
                            type: 'PURCHASE',
                            currency: currencys,
                            status: 'PENDING',
                            paymentMethodType: 'mtnmomo',
                            orderTrackingId: createdUUIDs,
                            amount: priceItem.price.toString(),
                            paymentMethodId: paymentMethodId ?? null,
                        },
                    });

                    // create a new entry in the purchase table
                    await prisma.purchase.create({
                        data: {
                            userId,
                            status: 'PENDING',
                            [resourceField]: resource.id,
                            transactionId: transaction.id,
                            expiresAt: addDays(new Date(), 3), // 72hrs
                            resolutions: resSelector(priceItem.resolution),
                        },
                    });

                    // create a new watchlist entry
                    await prisma.watchlist.create({
                        data: {
                            userId,
                            type: 'PURCHASED',
                            [resourceField]: resource,
                        },
                    });

                    res.status(200).json({
                        message: 'Payment pending approval',
                        orderTrackingId: createdUUIDs,
                    });

                    break;
                } catch (error) {
                    returnError(error.message, 500);
                }

            case 'visa':
            case 'airtelmoney':
                // process wallet payment
                try {
                    console.log('purchase-pesapal');
                    let PESA_URL = 'https://pay.pesapal.com/v3';
                    let PesaRequestLink = `${PESA_URL}/api/Transactions/SubmitOrderRequest`;

                    let headers = {
                        'Content-Type': 'application/json',
                        Accept: 'application/json',
                        Authorization: req.bearertk,
                    };

                    let requestParameters = {
                        id: createdUUIDs,
                        amount: amounts,
                        currency: 'UGX',
                        description: 'Purchase for film ',
                        // callback_url: "https://api.nyatimotionpictures.com/api/v1/payment/pesapal/callback/web",
                        callback_url:
                            type === 'streamWeb'
                                ? 'https://stream.nyatimotionpictures.com/pesapay/success'
                                : 'https://nyatimotionpictures.com/donate/pesapay/success',
                        cancellation_url:
                            type === 'streamWeb'
                                ? 'https://stream.nyatimotionpictures.com/pesapay/cancel'
                                : 'https://nyatimotionpictures.com/donate/pesapay/cancel',
                        notification_id: req.ipn_id,
                        branch: '',
                        billing_address: {
                            phone_number: phoneNumber,
                            email_address: '',
                            country_code: '', //optional
                            first_name: '', //optional
                            middle_name: '',
                            last_name: '',
                            line_1: '',
                            line_2: '',
                            city: '',
                            state: '',
                            postal_code: '',
                            zip_code: '',
                        },
                    };

                    let submitOrderRequest = await axios.post(
                        PesaRequestLink,
                        requestParameters,
                        {
                            headers: headers,
                        }
                    );

                    if (submitOrderRequest.data.error) {
                        next(submitOrder.data.error);
                    } else {
                        // Save the transaction including the orderTrackingId
                        const transaction = await prisma.transaction.create({
                            data: {
                                userId,
                                type: 'PURCHASE',
                                amount: priceItem.price.toString(),
                                currency: resource.pricing.currency,
                                status: 'PENDING',
                                paymentMethodType: 'PesaPal',
                                orderTrackingId:
                                    submitOrderRequest.data.order_tracking_id,
                                paymentMethodId: paymentMethodId ?? null,
                            },
                        });

                        // create a new entry in the purchase table
                        await prisma.purchase.create({
                            data: {
                                userId,
                                status: 'PENDING',
                                [resourceField]: resourceId,
                                transactionId: transaction.id,
                                expiresAt: addDays(new Date(), 3), // 72hrs
                                resolutions: resSelector(priceItem.resolution),
                            },
                        });

                        // create a new watchlist entry
                        await prisma.watchlist.create({
                            data: {
                                userId,
                                type: 'PURCHASED',
                                [resourceField]: resource,
                            },
                        });

                        res.status(200).json({
                            // token: req.bearertk,
                            // ipn: req.ipn_id,
                            // createdUUID: createdUUID
                            ...submitOrderRequest.data,
                        });
                    }
                } catch (error) {
                    returnError(error.message, 500);
                }
                break;

            default:
                returnError('Invalid payment type', 400);
        }
    } catch (error) {
        console.log('Received error', error);
        if (!error.statusCode) {
            error.statusCode = 500;
        }
        next(error);
    }
};

/**
 * @name donateFilm
 * @description function to donate to a film
 * @type {import('express').RequestHandler}
 */
export const donateToFilm = async (req, res, next) => {
    try {
        const { userId, filmId } = req.params;
        const body = req.body;
        const isProduction = true;

        console.log('body', body, userId, filmId);

        if (!userId || !filmId || !body.amount) {
            returnError('Unauthorized purchase', 401);
        }

        const film = await prisma.film.findUnique({
            where: { id: filmId },
        });

        if (!film) returnError('The resource can not be found.', 404);

        if (!body?.option) returnError('Payment method is required', 400);

        const PAYMENTS_API = env.NYATI_PAYMENTS_API_URL;
        //  const currency = isProduction ? 'UGX' : 'EUR';

        const createdUUID = uuidv4(new Date());

        let amount = body.amount.toString();
        const phoneNumber =
            body.phoneCode.replace('+', '') + body.paymentNumber;
        // switch by payment type
        switch (body.option) {
            case 'mtnmomo':
                try {
                    let TargetEnv = 'mtnuganda';
                    let subscription_Key = 'fedc2d49cbdb42328a2e94e846818ab8';
                    let currency = 'UGX';
                    let MTNRequestLink = `https://proxy.momoapi.mtn.com/collection/v1_0/requesttopay`;
                    // let callbackURL = "https://api.nyatimotionpictures.com/api/v1/payment/mtn/callback/web"

                    let requestParameters = {
                        amount: amount,
                        currency: currency,
                        externalId: createdUUID,
                        payer: {
                            partyIdType: 'MSISDN',
                            partyId: phoneNumber,
                        },
                        payerMessage: `Donation for film `,
                        payeeNote: '',
                    };

                    let headers = {
                        'Content-Type': 'application/json',
                        Authorization: req.mtn_access_token,
                        'X-Callback-Url': `https://api.nyatimotionpictures.com/api/v1/film/checkpaymentstatus/${createdUUID}`,
                        'X-Reference-Id': `${createdUUID}`,
                        'X-Target-Environment': TargetEnv,
                        'Ocp-Apim-Subscription-Key': subscription_Key,
                    };

                    //  console.log("requestParameters", requestParameters)
                    //  console.log("headers", headers)

                    let submitOrderRequest = await axios.post(
                        MTNRequestLink,
                        requestParameters,
                        {
                            headers: headers,
                        }
                    );

                    console.log(
                        'submitOrderRequest',
                        submitOrderRequest.statusText
                    );

                    if (submitOrderRequest.statusText !== 'Accepted') {
                        returnError('Payment Processing failed', 400);
                    }

                    // Save the transaction including the orderTrackingId
                    const transaction = await prisma.transaction.create({
                        data: {
                            userId,
                            type: 'DONATION',
                            amount: body?.amount.toString(),
                            currency: body?.currency ?? 'UGX',
                            status: 'PENDING',
                            paymentMethodType: 'mtnmomo',
                            orderTrackingId: createdUUID,
                            paymentMethodId: body.paymentMethodId
                                ? body.paymentMethodId
                                : null,
                        },
                    });

                    await prisma.donation.create({
                        data: {
                            userId,
                            transactionId: transaction.id,
                            filmId: film.id,
                            status: 'PENDING',
                        },
                    });

                    res.status(200).json({
                        status: 'PENDING',
                        orderTrackingId: createdUUID,
                    });

                    break;
                } catch (error) {
                    returnError(error.message, 500);
                }
            case 'visa':
            case 'airtelmoney':
                try {
                    // let generatedAuthTK = await generatePesaAuthTk(req, res, next);
                    // console.log("generatedAuthTK", req.bearertk )
                    let PESA_URL = 'https://pay.pesapal.com/v3';
                    let PesaRequestLink = `${PESA_URL}/api/Transactions/SubmitOrderRequest`;

                    let headers = {
                        'Content-Type': 'application/json',
                        Accept: 'application/json',
                        Authorization: req.bearertk,
                    };

                    let requestParameters = {
                        id: createdUUID,
                        amount: amount,
                        currency: 'UGX',
                        description: 'Donation for film ',
                        // callback_url: "https://api.nyatimotionpictures.com/api/v1/payment/pesapal/callback/web",
                        callback_url:
                            body?.type === 'streamWeb'
                                ? 'https://stream.nyatimotionpictures.com/pesapay/success'
                                : 'https://nyatimotionpictures.com/donate/pesapay/success',
                        cancellation_url:
                            body?.type === 'streamWeb'
                                ? 'https://stream.nyatimotionpictures.com/pesapay/cancel'
                                : 'https://nyatimotionpictures.com/donate/pesapay/cancel', //optional
                        notification_id: req.ipn_id,
                        branch: '',
                        billing_address: {
                            phone_number: phoneNumber,
                            email_address: '',
                            country_code: '', //optional
                            first_name: '', //optional
                            middle_name: '',
                            last_name: '',
                            line_1: '',
                            line_2: '',
                            city: '',
                            state: '',
                            postal_code: '',
                            zip_code: '',
                        },
                    };

                    let submitOrderRequest = await axios.post(
                        PesaRequestLink,
                        requestParameters,
                        {
                            headers: headers,
                        }
                    );

                    //console.log("submitOrderRequest", submitOrderRequest)
                    if (submitOrderRequest.data.error) {
                        next(submitOrder.data.error);
                    } else {
                        const transaction = await prisma.transaction.create({
                            data: {
                                userId,
                                type: 'DONATION',
                                amount: body?.amount.toString(),
                                currency: body?.currency ?? 'UGX',
                                status: 'PENDING',

                                paymentMethodType: 'PesaPal',
                                orderTrackingId:
                                    submitOrderRequest.data.order_tracking_id,
                                paymentMethodId: body.paymentMethodId
                                    ? body.paymentMethodId
                                    : null,
                            },
                        });

                        await prisma.donation.create({
                            data: {
                                userId,
                                transactionId: transaction.id,
                                filmId: film.id,
                                status: 'PENDING',
                            },
                        });

                        res.status(200).json({
                            // token: req.bearertk,
                            // ipn: req.ipn_id,
                            // createdUUID: createdUUID
                            ...submitOrderRequest.data,
                        });
                    }
                } catch (error) {
                    returnError(error.message, 500);
                }

                break;

            default:
                returnError('Invalid payment type', 400);
        }
    } catch (error) {
        console.log('Received error', error);
        if (!error.statusCode) {
            error.statusCode = 500;
        }
        next(error);
    }
};

/**
 *
 * MTN CALLBACK
 *
 */

/**
 * @name checkPaymentStatus
 * @description function to verify payment
 * @type {import('express').RequestHandler}
 */

export const checkPaymentStatus = async (req, res, next) => {
    try {
        const { orderId: orderTrackingId } = req.params;

        if (!orderTrackingId) returnError('Order tracking id is required', 400);

        // fetch the transaction with the orderTrackingId
        const existingTransaction = await prisma.transaction.findFirst({
            where: { orderTrackingId },
            include: {
                purchase: {
                    select: {
                        id: true,
                    },
                },
            },
        });

        if (!existingTransaction) returnError('Transaction not found', 404);

        // const PAYMENTS_API = env.NYATI_PAYMENTS_API_URL;

        switch (existingTransaction.paymentMethodType) {
            case 'mtnmomo':
                try {
                    // const URL = `${PAYMENTS_API}/mtn/app/checkstatus/${orderTrackingId}`;
                    // const response = await axios.get(URL, {
                    //     headers: { 'Content-Type': 'application/json' },
                    // });

                    const { status, data } = await checkMtnStatus({
                        trackingId: orderTrackingId,
                        token: req.mtn_access_token,
                    });

                    if (!status) {
                        returnError('Payment failed', 400);
                    }

                    switch (status) {
                        case 'Transaction Successful':
                            if (data.financialTransactionId) {
                                // update the transaction
                                const dataParams = {
                                    status: 'SUCCESS',
                                    financialTransactionId:
                                        data.financialTransactionId,
                                };

                                const isPurchase =
                                    existingTransaction.type === 'PURCHASE' &&
                                    existingTransaction.purchase;

                                const isDonation =
                                    existingTransaction.type === 'DONATION';

                                if (isPurchase) {
                                    dataParams.purchase = {
                                        update: {
                                            where: {
                                                id: existingTransaction.purchase
                                                    .id,
                                            },
                                            data: {
                                                valid: true,
                                                status: 'SUCCESS',
                                            },
                                        },
                                    };
                                }

                                if (isDonation) {
                                    dataParams.donation = {
                                        update: {
                                            where: {
                                                transactionsId:
                                                    existingTransaction.id,
                                            },
                                            data: {
                                                status: 'SUCCESS',
                                            },
                                        },
                                    };
                                }

                                const updated = await prisma.transaction.update(
                                    {
                                        where: { id: existingTransaction.id },
                                        data: dataParams,
                                        include: { purchase: true },
                                    }
                                );

                                res.status(200).json({
                                    status: 'SUCCESSFUL',
                                    transaction: updated,
                                });
                            }
                            break;
                        case 'Transaction has Failed':
                        case 'Transaction Rejected':
                            const updated = await prisma.transaction.update({
                                where: { id: existingTransaction.id },
                                data: { status: 'FAILED' },
                                include: { purchase: true },
                            });

                            if (transaction.type === 'PURCHASE') {
                                // delete the purchase
                                await prisma.purchase.delete({
                                    where: {
                                        id: existingTransaction.purchaseId,
                                    },
                                });
                            }

                            if (transaction.type === 'DONATION') {
                                await prisma.donation.delete({
                                    where: {
                                        transactionsId: existingTransaction.id,
                                    },
                                });
                            }

                            await prisma.watchlist.delete({
                                where: {
                                    OR: [
                                        {
                                            film: updated?.purchase?.filmId,
                                        },
                                        {
                                            seasonId:
                                                updated.purchase?.seasonId,
                                        },
                                    ],
                                    userId: updated.userId,
                                    type: 'PURCHASED',
                                },
                            });

                            res.status(200).json({
                                status: 'FAILED',
                            });
                            break;
                        case 'Transaction Timeout':
                            const transaction = await prisma.transaction.update(
                                {
                                    where: { id: existingTransaction.id },
                                    data: { status: 'FAILED' },
                                    include: { purchase: true },
                                }
                            );

                            if (transaction.type === 'PURCHASE') {
                                // delete the purchase
                                await prisma.purchase.delete({
                                    where: {
                                        id: existingTransaction.purchaseId,
                                    },
                                });
                            }

                            if (transaction.type === 'DONATION') {
                                await prisma.donation.delete({
                                    where: {
                                        transactionsId: existingTransaction.id,
                                    },
                                });
                            }

                            await prisma.watchlist.delete({
                                where: {
                                    OR: [
                                        {
                                            film: transaction?.purchase?.filmId,
                                        },
                                        {
                                            seasonId:
                                                transaction.purchase?.seasonId,
                                        },
                                    ],
                                    userId: transaction.userId,
                                    type: 'PURCHASED',
                                },
                            });

                            res.status(200).json({
                                status: 'TIMEOUT',
                            });
                            break;
                        case 'Transaction Pending':
                            res.status(200).json({
                                status: 'PENDING',
                            });
                            break;
                        default:
                            returnError('Payment failed', 400);
                    }
                    break;
                } catch (error) {
                    throw error;
                }
            case 'airtel':
                break;
            case existingTransaction.paymentMethodType.includes('pesapal'):
                break;
        }
    } catch (error) {
        console.log('error', error);
        if (!error.statusCode) {
            error.statusCode = 500;
        }
        next(error);
    }
};

/**
 * @name pesapalCheckPaymentStatus
 * @description function to check pesapal payment status
 */
export const checkPesapalPaymentStatus = async (req, res, next) => {
    try {
        const { OrderTrackingId } = req.query;

        let orderTrackingId = OrderTrackingId;

        if (!orderTrackingId) returnError('Order tracking id is required', 400);

        // fetch the transaction with the orderTrackingId
        const existingTransaction = await prisma.transaction.findFirst({
            where: { orderTrackingId },
            include: {
                purchase: {
                    select: {
                        id: true,
                    },
                },
            },
        });

        if (!existingTransaction) returnError('Transaction not found', 404);

        // const PAYMENTS_API = env.NYATI_PAYMENTS_API_URL;

        switch (existingTransaction.paymentMethodType) {
            case 'Pesapal' ||
                existingTransaction.paymentMethodType?.includes('pesapal'):
                try {
                    let PESA_URL = 'https://pay.pesapal.com/v3';
                    let PesaRequestLink = `${PESA_URL}/api/Transactions/GetTransactionStatus?orderTrackingId=${orderTrackingId}`;

                    let headers = {
                        'Content-Type': 'application/json',
                        Accept: 'application/json',
                        Authorization: req.pesa_access_token,
                    };

                    let submitStatusRequest = await axios.get(PesaRequestLink, {
                        headers: headers,
                    });

                    if (!submitStatusRequest.data) {
                        // console.log("error", submitStatusRequest.data)
                        returnError('Check Payment Failed', 500);
                    }

                    const {
                        payment_method,
                        amount,
                        payment_status_description,
                        description,
                        payment_account,
                        currency,
                        message,
                    } = submitStatusRequest.data;

                    if (
                        existingTransaction.status?.toLowerCase() !== 'pending'
                    ) {
                        res.status(200).json({
                            payment_status_description:
                                payment_status_description,
                            paidAmount: amount,
                            paymentType: `PesaPal-${payment_method}`,
                            transactionId: existingTransaction.id,
                            currency: currency,
                        });
                        break;
                    } else {
                        const selectMessage = (shortMessage) => {
                            switch (shortMessage) {
                                case 'failed':
                                    return 'Transaction has Failed';
                                case 'completed':
                                    return 'Transaction Successful';
                                case 'pending':
                                    return 'Transaction Pending';
                                case 'rejected':
                                    return 'Transaction Rejected';
                                case 'invalid':
                                    return 'Transaction invalid';
                                case 'reversed':
                                    return 'Transaction reversed';
                                default:
                                    return null;
                            }
                        };

                        let status = selectMessage(
                            payment_status_description.toLowerCase()
                        );

                        if (!status) {
                            returnError('Payment failed', 400);
                        }

                        switch (status) {
                            case 'Transaction Successful':
                                // update the transaction
                                const dataParams = {
                                    status: 'SUCCESS',
                                };

                                const isPurchase =
                                    existingTransaction.type === 'PURCHASE' &&
                                    existingTransaction.purchase;

                                const isDonation =
                                    existingTransaction.type === 'DONATION';

                                if (isPurchase) {
                                    dataParams.purchase = {
                                        update: {
                                            where: {
                                                id: existingTransaction.purchase
                                                    .id,
                                            },
                                            data: {
                                                valid: true,
                                                status: 'SUCCESS',
                                            },
                                        },
                                    };
                                }

                                if (isDonation) {
                                    dataParams.donation = {
                                        update: {
                                            where: {
                                                transactionsId:
                                                    existingTransaction.id,
                                            },
                                            data: {
                                                status: 'SUCCESS',
                                            },
                                        },
                                    };
                                }

                                let updated = await prisma.transaction.update({
                                    where: { id: existingTransaction.id },
                                    data: dataParams,
                                    include: { purchase: true },
                                });

                                res.status(200).json({
                                    status: 'SUCCESSFUL',
                                    transaction: updated,
                                });

                                break;
                            case 'Transaction has Failed':
                            case 'Transaction Rejected':
                                let update = await prisma.transaction.update({
                                    where: { id: existingTransaction.id },
                                    data: { status: 'FAILED' },
                                    include: { purchase: true },
                                });

                                if (transaction.type === 'PURCHASE') {
                                    // delete the purchase
                                    await prisma.purchase.delete({
                                        where: {
                                            id: existingTransaction.purchaseId,
                                        },
                                    });
                                }

                                if (transaction.type === 'DONATION') {
                                    await prisma.donation.delete({
                                        where: {
                                            transactionsId:
                                                existingTransaction.id,
                                        },
                                    });
                                }

                                await prisma.watchlist.delete({
                                    where: {
                                        OR: [
                                            {
                                                film: update?.purchase?.filmId,
                                            },
                                            {
                                                seasonId:
                                                    update.purchase?.seasonId,
                                            },
                                        ],
                                        type: 'PURCHASED',
                                        userId: update.userId,
                                    },
                                });
                                res.status(200).json({
                                    status: 'FAILED',
                                });
                                break;
                            case 'Transaction Timeout':
                                updated = await prisma.transaction.update({
                                    where: { id: existingTransaction.id },
                                    data: { status: 'FAILED' },
                                    include: { purchase: true },
                                });

                                if (transaction.type === 'PURCHASE') {
                                    // delete the purchase
                                    await prisma.purchase.delete({
                                        where: {
                                            id: existingTransaction.purchaseId,
                                        },
                                    });
                                }

                                if (transaction.type === 'DONATION') {
                                    await prisma.donation.delete({
                                        where: {
                                            transactionsId:
                                                existingTransaction.id,
                                        },
                                    });
                                }
                                await prisma.watchlist.delete({
                                    where: {
                                        OR: [
                                            { film: update?.purchase?.filmId },
                                            {
                                                seasonId:
                                                    update.purchase?.seasonId,
                                            },
                                        ],
                                        type: 'PURCHASED',
                                        userId: update.userId,
                                    },
                                });
                                res.status(200).json({
                                    status: 'TIMEOUT',
                                });
                                break;
                            case 'Transaction Pending':
                                res.status(200).json({
                                    status: 'PENDING',
                                });
                                break;
                            default:
                                returnError('Payment failed', 400);
                        }
                    }
                    break;
                } catch (error) {
                    throw error;
                }

            default:
                returnError('Invalid payment type', 400);
                break;
        }
    } catch (error) {
        console.log('error', error);
        if (!error.statusCode) {
            error.statusCode = 500;
        }
        next(error);
    }
};
