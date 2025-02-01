import path from 'path';
import ffmpeg from '@/services/ffmpegwithpath.js';

const RESOLUTIONS = {
    sd: 480,
    hd: 720,
    // full_hd: 1080,
    // ultra_hd: 2160,
};

export async function transcodeVideo(filePath, fileName, outputDir) {
    const promises = Object.entries(RESOLUTIONS).map(([label, height]) => {
        console.log(`Transcoding ${label} video...`);
        const filename = fileName.split('.').shift().replace(/\s/g, '_');
        const outputPath = path.join(outputDir, `${label}_${filename}.mp4`);
        return new Promise((resolve, reject) => {
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

                ffmpeg(filePath)
                    .videoCodec('libx264')
                    .audioCodec('libmp3lame')
                    .size(`?x${height}`)
                    .on('end', () => resolve({ label, outputPath }))
                    .on('error', reject)
                    .save(outputPath);
            } catch (error) {
                console.error('Error transcoding video:', error);
                reject(error);
            }
        });
    });

    return Promise.all(promises);
}
