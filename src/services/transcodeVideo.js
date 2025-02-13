import path from 'path';
import Ffmpeg from 'fluent-ffmpeg';
import { io } from '@/utils/sockets.js';
import { uploadToBucket } from './s3.js';
import ChunkService from './chunkService.js';
import fs from 'fs';
import { formatBitrate } from '@/utils/formatBitrate.js';
import prisma from '@/utils/db.mjs';
import { returnError } from '@/utils/returnError.js';

let RESOLUTIONS = {
    SD: 480,
    HD: 720,
    FHD: 1080,
    UHD: 2160,
};

const resolutionsArray = [
    { name: '480p', label: 'SD', width: 854, height: 480, bitrate: 1000 }, // 480p   SD
    { name: '720p', label: 'HD', width: 1280, height: 720, bitrate: 2500 }, // 720p   HD
    { name: '1080p', label: 'FHD', width: 1920, height: 1080, bitrate: 5000 }, // 1080p Full HD
    { name: '4K', label: 'UHD', width: 3840, height: 2160, bitrate: 15000 }, // 4K UHD
    // { name: "360p", width: 640, height: 360, bitrate: "600k" }, // 360p
];

/**
    @typedef {Object} VideoDetails
    * @property {"SD" | "HD" | "FHD" | "UHD"} resolution - Label of the resolution
    * @property {"SD" | "HD" | "FHD" | "UHD" } label 
    * @property {string} name - Width of the video in pixels
    * @property {string} format - Height of the video in pixels
    * @property {string} encoding - Output path of the transcoded video
    * @property {string} size - Output path of the transcoded video
    * @property {string} duration - Duration of the video in seconds
    * @property {number} bitrate - Bitrate of the video in bits per second
    * @property {string} url - URL of the transcoded video on DigitalOcean Spaces
 */

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
 * @typedef{object} transcodeParams
 * @property {string} type - Type of the video. Either "film" or "episode"
 * @property {string} filePath - Path to the video file
 * @property {string} fileName - Name of the video file
 * @property {string} outputDir - Directory to save the transcoded videos
 * @property {string} clientId - Client ID to emit progress updates
 * @property {string} bucketName - Bucket name to upload the transcoded videos
 * @property {({["SD" | "HD" | "FHD" | "UHD"]: number })=> object} onPreTranscode - Callback function that takes an object of resolutions as input and returns an updated object of resolutions. This can be used to modify the resolutions before transcoding starts.
 * @property {(videoData: VideoDetails)=> void} onUploadComplete - Callback function to be called when the transcoded video has been uploaded to S3.
 * @returns {Promise<void>}
 */

/**
 * @name transcodeVideo
 * @description Function to transcode a video into multiple resolutions using ffmpeg and upload them to DigitalOcean spaces
 * @example
 * ```javascript
 * import { transcodeVideo } from "@/services/transcodeVideo";
 *
 * const filePath = "/path/to/video.mp4";
 * const fileName = "my-video.mp4";
 * const outputDir = "/path/to/output/directory/";
 * const clientId = "client-id-123";
 * const bucketName = "my-bucket-name";
 *
 * transcodeVideo({
 *   type: "film",
 *   filePath,
 *   fileName,
 *   outputDir,
 *   clientId,
 *   bucketName,
 * }).then(() => {
 *   console.log("All files have been transcoded.");
 * });
 * ```
 * @param {transcodeParams} params
 */

export async function transcodeVideo({
    type,
    filePath,
    fileName,
    outputDir,
    clientId,
    bucketName,
    onPreTranscode,
    onUploadComplete,
}) {
    if (onPreTranscode) {
        RESOLUTIONS = await onPreTranscode(RESOLUTIONS);
    }

    const results = [];

    try {
        // initial probe on the main file
        const initialMetadata = await new Promise((resolve, reject) => {
            Ffmpeg(filePath).ffprobe((err, data) => {
                if (err) reject(err);
                else resolve(data.format);
            });
        });

        // loop through each resolution and transcode the video
        for (const [label, height] of Object.entries(RESOLUTIONS)) {
            try {
                const { filename } = new ChunkService().formatFileName(
                    fileName
                );
                const name = `${label}_${filename}.mp4`;
                const outputPath = path.join(outputDir, name);
                const result = await new Promise((resolve, reject) => {
                    let metadata = { ...initialMetadata };

                    const command = Ffmpeg(filePath)
                        .videoCodec('libx264')
                        .size(`?x${height}`)
                        .outputOptions([
                            '-preset ultrafast',
                            '-movflags faststart',
                        ])
                        .audioCodec('copy')
                        .outputOptions('-map 0') // Ensures all streams (video, audio, subtitles) are included
                        .outputOptions('-c:s webvtt') // Convert subtitles to WebVTT
                        .format('mp4')
                        .output(outputPath)
                        .on('start', () => console.log('Transcoding started'))
                        .on('progress', (progress) => {
                            const customProgress = Math.round(progress.percent);
                            io.to(clientId).emit('TranscodeProgress', {
                                label,
                                customProgress,
                            });
                        })
                        .on('error', (error) => {
                            console.log(
                                `Transcoding error for ${label}`,
                                error
                            );

                            reject(error);
                        })
                        .on('end', async () => {
                            // create a readable stream from the transcoded file
                            const ffstream = fs.createReadStream(outputPath);

                            const bucketParams = {
                                bucketName,
                                key: name,
                                buffer: ffstream,
                                contentType: 'video/mp4',
                                isPublic: true,
                            };
                            uploadToBucket(bucketParams, (progress) => {
                                io.to(clientId).emit('uploadProgress', {
                                    progress,
                                    content: {
                                        type,
                                        resolution: label,
                                    },
                                });
                            })
                                .then(async (data) => {
                                    // ffprobe the transcoded stream
                                    const finalMetadata = await new Promise(
                                        (resolve, reject) => {
                                            Ffmpeg(outputPath).ffprobe(
                                                (err, data) => {
                                                    if (err) reject(err);
                                                    else resolve(data.format);
                                                }
                                            );
                                        }
                                    );

                                    metadata = {
                                        ...initialMetadata,
                                        ...finalMetadata,
                                    };

                                    const videoData = {
                                        resolution: label,
                                        name: bucketParams.key,
                                        format: 'video/mp4',
                                        url: data.url,
                                        encoding: 'libx264',
                                        size: metadata.size.toString(),
                                        duration: metadata.duration,
                                        bitrate: formatBitrate(
                                            metadata.bit_rate ?? 0
                                        ),
                                    };

                                    // callback function to handle the completion
                                    if (onUploadComplete) {
                                        onUploadComplete(videoData);
                                    }

                                    // remove the local copy of the video after uploading it to s3
                                    await fs.promises.rm(outputPath);
                                    resolve();
                                })
                                .catch((uploadError) => reject(uploadError));
                        });

                    command.run();
                });

                results.push(result);
            } catch (error) {
                console.error(`Error processing resolution ${label}:`, error);
                throw new Error(`Failed to process resolution ${label}`);
            }
        }

        // remove the original file after transcoding
        await fs.promises.rm(filePath);
        // Clean up the directory containing the original file
        return Promise.all(results);
    } catch (initialFfprobeError) {
        console.error('initial ffprobe error', initialFfprobeError);
        throw initialFfprobeError;
    }
}

export async function transcodeOneAtATimeOld(
    filePath,
    fileName,
    outputDir,
    clientId,
    filmInfo
) {
    try {
        if (!fs.existsSync(filePath)) {
            throw new Error('File not found or not accessible: ' + filePath);
        }

        if (!filePath) {
            throw new Error('File path is required');
        }
        if (!fileName) {
            throw new Error('File name is required');
        }
        if (!outputDir) {
            throw new Error('Output directory is required');
        }

        const duration = await new Promise((resolve, reject) => {
            Ffmpeg.ffprobe(filePath, (err, metadata) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(metadata.format.duration); // Duration in seconds
                }
            });
        });

        for (const {
            name,
            label,
            width,
            height,
            bitrate,
        } of resolutionsArray) {
            const outputFilePath = path.join(outputDir, `${label}_${fileName}`);
            console.log(`Starting transcoding for ${name}...`);

            await new Promise((resolve, reject) => {
                Ffmpeg(filePath)
                    .videoCodec('libx264')
                    .audioCodec('aac')
                    .format('mp4')
                    .size(`${width}x${height}`)
                    .videoBitrate(bitrate)
                    // .outputOptions([
                    //     '-preset veryfast', // Faster encoding
                    //     '-crf 23', // Quality control (lower = better)
                    //     '-pix_fmt yuv420p', // Ensures compatibility
                    //     '-movflags faststart', // Allows streaming without full download
                    //     '-maxrate ' + bitrate, // Ensures bitrate cap
                    //     '-bufsize ' + parseInt(bitrate) * 2 + 'k' // Smooths out bitrate spikes
                    // ])
                    .output(outputFilePath)
                    .on('start', () => console.log('Transcoding started'))
                    .on('progress', (progress) => {
                        console.log(
                            `Transcode Progress: ${label} ${progress.targetSize} ${progress.percent}%`
                        );
                        let customProgress = Math.round(progress.percent);
                        io.to(clientId).emit('TranscodeProgress', {
                            label,
                            customProgress,
                        });
                    })
                    .on('end', async () => {
                        console.log(`Transcoding finished for ${name}`);

                        try {
                            console.log(
                                `Uploading ${name} to DigitalOcean Spaces...`
                            );

                            if (!fs.existsSync(outputFilePath)) {
                                console.error(
                                    `Transcoded file missing: ${outputFilePath}`
                                );
                                reject(
                                    new Error(
                                        `Transcoded file missing: ${outputFilePath}`
                                    )
                                );
                                return;
                            }

                            let bucketParams = {
                                bucketName: filmInfo.resourceId,
                                key: `${label}_${fileName}`,
                                buffer: fs.createReadStream(outputFilePath),
                                contentType: 'video/mp4',
                                isPublic: true,
                            };

                            switch (filmInfo.type) {
                                case 'film':
                                    const data = await uploadToBucket(
                                        bucketParams,
                                        (progress) => {
                                            broadcastProgress({
                                                progress,
                                                clientId,
                                                content: {
                                                    resolution: label,
                                                    type: 'film',
                                                },
                                            });
                                        }
                                    );

                                    if (data.url) {
                                        // create a video record with all the details including the signed url
                                        const videoData = {
                                            filmId: filmInfo.resourceId,
                                            resolution: label,
                                            name: `${label}_${fileName}`,
                                            format: 'video/mp4',
                                            url: data.url,
                                            encoding: 'libx264',
                                            size: formatFileSize(
                                                fs.statSync(outputFilePath).size
                                            ),
                                        };

                                        await prisma.video.create({
                                            data: videoData,
                                        });
                                    }
                                    break;
                                case 'episode':
                                    bucketParams.bucketName = `${filmInfo?.resource.season?.filmId}-${filmInfo.resource.seasonId}`;
                                    const upload = await uploadToBucket(
                                        bucketParams,
                                        (progress) => {
                                            broadcastProgress({
                                                progress,
                                                clientId,
                                                content: {
                                                    resolution: label,
                                                    type: 'episode',
                                                },
                                            });
                                        }
                                    );

                                    if (upload.url) {
                                        // create a video record with all the details including the signed url
                                        const videoData = {
                                            episodeId: filmInfo.resourceId,
                                            resolution: label,
                                            name: `${label}_${fileName}`,
                                            format: 'video/mp4',
                                            url: upload.url,
                                            encoding: 'libx264',
                                            size: formatFileSize(
                                                fs.statSync(outputFilePath).size
                                            ),
                                        };

                                        await prisma.video.create({
                                            data: videoData,
                                        });
                                    }
                                    break;
                                default:
                                    returnError(
                                        'Type "film" or "episode" is required',
                                        400
                                    );
                                    break;
                            }

                            // Delete the transcoded file after upload
                            fs.unlink(outputFilePath, (err) => {
                                if (err)
                                    console.error(
                                        `Error deleting ${name}:`,
                                        err.message
                                    );
                                else console.log(`${name} deleted locally.`);
                            });
                            resolve({ label, outputFilePath: outputFilePath }); // Proceed to the next resolution
                        } catch (error) {
                            console.log('error', error);
                            reject(error); // If upload fails, reject the promise
                        }
                    })
                    .on('error', (error) => reject(error))
                    // .save(outputFilePath);
                    .run();
            });
        }

        console.log('All resolutions processed and uploaded!');
        // After processing all resolutions, delete the main file
        fs.unlink(filePath, (err) => {
            if (err) console.error('Error deleting main file:', err.message);
            else console.log('Main file deleted.');
        });
    } catch (error) {
        console.error('Error transcoding video:', error);
        throw error;
    }
}
