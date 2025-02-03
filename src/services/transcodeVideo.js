import path from 'path';
import Ffmpeg from 'fluent-ffmpeg';
import { io } from '@/utils/sockets.js';
// import ffmpegPath from "@ffmpeg-installer/ffmpeg";



/**
 * Transcode a video to multiple resolutions
 * @type {{
    *  sd: number,
    *  hd: number,
    *  full_hd: number,
    *  ultra_hd: number
 }}
 */

const RESOLUTIONS = {
    sd: 480,
    hd: 720,
    full_hd: 1080,
    ultra_hd: 2160,
};

/**
 * Transcode a video to multiple resolutions
 * @param {string} filePath - Path to the video file
 * @param {string} fileName - Name of the video file
 * @param {string} outputDir - Directory to save the transcoded videos
 * @returns {Promise<Array<{label: string, outputPath: string}>>}
 */

export async function transcodeVideo(filePath, fileName, outputDir, clientId) {
    // Ffmpeg.setFfmpegPath(ffmpegPath.path);
    const promises = Object.entries(RESOLUTIONS).map(async ([label, height]) => {
        const filename = fileName.split('.').shift().replace(/\s/g, '_');
        const outputPath = path.join(outputDir, `${label}_${filename}.mp4`);
        return  await new Promise((resolve, reject) => {
            try {
                if (!filePath) {
                    throw new Error('File path is required');
                }
                if (!fileName) {
                    throw new Error('File name is required');
                }
                if (!outputDir) {
                    throw new Error('Output directory is required');
                }

                Ffmpeg(filePath)
                    .videoCodec('libx264')
                    .output(outputPath)
                    .size(`?x${height}`)
                    .on('start', () => console.log('Transcoding started'))
                    .on('progress', (progress) =>{
                        console.log(`Transcode Progress: ${label} ${progress.targetSize} ${progress.percent}%`)
                        let customProgress = Math.round(progress.percent)
                        io.to(clientId).emit("TranscodeProgress", { label, customProgress })
                    }
                    )
                    .on('end', () => resolve({ label, outputPath }))
                    .on('error', (error) => reject(error))
                    .run();

                    
            } catch (error) {
                console.error('Error transcoding video:', error);
                reject(error);
            }
        });
       
    });

    return Promise.all(promises);
}
