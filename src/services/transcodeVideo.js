import path from 'path';
import Ffmpeg from 'fluent-ffmpeg';
import { io } from '@/utils/sockets.js';
import { uploadToBucket } from './s3.js';
import ChunkService from './chunkService.js';
import fs from 'fs';
import { formatBitrate } from '@/utils/formatBitrate.js';

const RESOLUTIONS = {
    SD: 480,
    HD: 720,
    FHD: 1080,
    UHD: 2160,
};

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
 * Transcode a video to multiple resolutions
 * @param {string} filePath - Path to the video file
 * @param {string} fileName - Name of the video file
 * @param {string} outputDir - Directory to save the transcoded videos
 * @param {string} clientId - Client ID to emit progress updates
 * @param {string} bucketName - Bucket name to upload the transcoded videos
 * @returns {Promise<VideoDetails[]>}
 */

export async function transcodeVideo(
    filePath,
    fileName,
    outputDir,
    clientId,
    bucketName,
    type
) {
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
                const filename = new ChunkService().formatFileName(fileName);
                const name = `${label}_${filename}.mp4`;
                const outputPath = path.join(outputDir, name);
                const result = await new Promise((resolve, reject) => {
                    let metadata = { ...initialMetadata };

                    const command = Ffmpeg(filePath)
                        .videoCodec('libx264')
                        .size(`?x${height}`)
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
                        .on('error', (error, stdout, stderr) => {
                            console.log(
                                `Transcoding error for ${label}`,
                                error
                            );
                            console.error('FFmpeg error:', error);
                            console.error('FFmpeg stdout:', stdout);
                            console.error('FFmpeg stderr:', stderr);
                            reject(error);
                        })
                        .on('end', async () => {
                            console.log(`${label} Transcoding ended`);

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
                                    console.log(
                                        `${label} Uploaded to Spaces:`,
                                        data.url
                                    );

                                    // ffprobe the transcoded stream
                                    const finalMetadata = await new Promise(
                                        (resolve, reject) => {
                                            Ffmpeg(outputPath).ffprobe(
                                                (err, data) => {
                                                    if (err) {
                                                        console.log(
                                                            'error',
                                                            err
                                                        );
                                                        reject(err);
                                                    } else resolve(data.format);
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

                                    // remove the local copy of the video after uploading it to s3
                                    fs.unlinkSync(outputPath);

                                    resolve(videoData);
                                })
                                .catch((uploadError) => {
                                    console.log(
                                        `Error uploading ${label}`,
                                        uploadError
                                    );
                                    reject(uploadError);
                                });
                        });

                    command.run();
                });

                results.push(result);
            } catch (error) {
                console.error(`Error processing resolution ${label}:`, error);
                throw new Error(`Failed to process resolution ${label}`);
            }
        }
        return Promise.all(results);
    } catch (initialFfprobeError) {
        console.log('initial ffprobe error', initialFfprobeError);
        throw initialFfprobeError;
    }
}
