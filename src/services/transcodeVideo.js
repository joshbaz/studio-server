import path from 'path';
import Ffmpeg from 'fluent-ffmpeg';
import { io } from '@/utils/sockets.js';
import { uploadToBucket } from './s3.js';
import ChunkService from './chunkService.js';
import fs from 'fs';
import { formatBitrate } from '@/utils/formatBitrate.js';
import prisma from '@/utils/db.mjs';
import { returnError } from '@/utils/returnError.js';
import { spawn } from 'child_process';
import { hlsUploadQueue, masterPlaylistQueue } from './queueWorkers.js';

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
];

// HLS Configuration for optimal streaming
const HLS_CONFIG = {
    segmentDuration: 6, // 6-second segments for optimal streaming
    playlistType: 'vod', // Video on demand
    segmentType: 'mpegts', // MPEG-TS segments
    flags: 'independent_segments', // Independent segments for better seeking
    maxBufferLength: 30, // 30 seconds buffer
    maxMaxBufferLength: 600, // 10 minutes max buffer
    backBufferLength: 90, // 90 seconds back buffer
    lowLatencyMode: true, // Enable low latency mode
    // Audio sync settings to prevent lag
    audioSampleRate: 48000, // 48kHz audio sample rate
    audioChannels: 2, // Stereo audio
    audioBitrate: 128, // 128kbps audio bitrate
    audioSync: true, // Enable audio sync correction
    videoSync: true, // Enable video sync correction
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
    * @property {string} url - URL of the HLS playlist on DigitalOcean Spaces
    * @property {string} hlsUrl - URL of the HLS playlist (same as url for HLS)
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
 * Generate HLS playlist and segments for a specific resolution with subtitle support
 * @param {string} inputPath - Path to the original video file
 * @param {string} outputDir - Output directory for HLS files
 * @param {string} filename - Base filename
 * @param {string} label - Resolution label (SD, HD, FHD, UHD)
 * @param {string} clientId - Client ID for progress updates
 * @returns {Promise<{playlistPath: string, subtitlePaths: string[]}>} - Path to the HLS playlist and subtitle files
 */
const generateHLSPlaylist = async (inputPath, outputDir, filename, label, clientId) => {
    console.log(`🎬 Generating HLS for ${label} with subtitle support...`);
    
    const hlsOutputDir = path.join(outputDir, `hls_${label}_${filename}`);
    fs.mkdirSync(hlsOutputDir, { recursive: true });
    
    const playlistPath = path.join(hlsOutputDir, `${label}_${filename}.m3u8`);
    const subtitlePaths = [];
    
    return new Promise((resolve, reject) => {
        const resolution = resolutionsArray.find(r => r.label === label);
        if (!resolution) {
            reject(new Error(`Resolution ${label} not found`));
            return;
        }

        // Change to the output directory to avoid path issues
        const originalCwd = process.cwd();
        process.chdir(hlsOutputDir);

        // First, extract available subtitle tracks
        const extractSubtitles = async () => {
            try {
                console.log(`📝 Extracting subtitle tracks for ${label}...`);
                
                return new Promise((resolveSubtitles, rejectSubtitles) => {
                    Ffmpeg(inputPath)
                        .ffprobe((err, metadata) => {
                            if (err) {
                                console.warn(`⚠️ Could not extract subtitle metadata: ${err.message}`);
                                resolveSubtitles([]);
                                return;
                            }
                            
                            // More comprehensive subtitle detection - look for ALL subtitle streams
                            const subtitleStreams = metadata.streams.filter(stream => 
                                stream.codec_type === 'subtitle'
                            );
                            
                            console.log(`📝 Found ${subtitleStreams.length} subtitle tracks:`, 
                                subtitleStreams.map(s => ({ 
                                    index: s.index, 
                                    language: s.tags?.language || s.tags?.title || `subtitle_${s.index}`, 
                                    codec: s.codec_name,
                                    disposition: s.disposition
                                }))
                            );
                            
                            resolveSubtitles(subtitleStreams);
                        });
                });
            } catch (error) {
                console.warn(`⚠️ Error extracting subtitles: ${error.message}`);
                return [];
            }
        };

        const generateHLSWithSubtitles = async (subtitleStreams) => {
            const command = Ffmpeg(inputPath);
            
            // Add subtitle input streams
            subtitleStreams.forEach((stream, index) => {
                command.input(inputPath);
                command.inputOptions([`-map 0:s:${index}`]);
            });
            
            // Start with basic HLS options
            command
                .outputOptions(`-c:v libx264`)
                .outputOptions(`-preset fast`)
                .outputOptions(`-crf 23`)
                .outputOptions(`-vf scale=${resolution.width}:${resolution.height}`)
                .outputOptions(`-c:a aac`)
                .outputOptions(`-b:a 128k`)
                .outputOptions(`-ar 48000`) // Set audio sample rate to 48kHz for better sync
                .outputOptions(`-ac 2`) // Stereo audio
                .outputOptions(`-async 1`) // Audio sync correction
                .outputOptions(`-vsync 1`) // Video sync correction
                .outputOptions(`-f hls`)
                .outputOptions(`-hls_time 6`)
                .outputOptions(`-hls_list_size 0`)
                .outputOptions(`-hls_segment_filename ${label}_${filename}_%03d.ts`)
                .outputOptions(`-hls_subtitle_path ${filename}_subtitles`) // Professional approach: Remove resolution prefix
                .outputOptions(`-hls_flags independent_segments`)
                .outputOptions(`-hls_playlist_type vod`)
                .output(`${label}_${filename}.m3u8`)
                .on('start', (commandLine) => {
                    console.log(`🚀 FFmpeg HLS command for ${label}:`, commandLine);
                    broadcastProgress({
                        progress: 0,
                        clientId,
                        content: { type: 'hls_generation', resolution: label }
                    });
                })
                .on('progress', (progress) => {
                    if (progress.percent) {
                        broadcastProgress({
                            progress: Math.round(progress.percent),
                            clientId,
                            content: { type: 'hls_generation', resolution: label }
                        });
                    }
                })
                .on('end', () => {
                    console.log(`✅ HLS generation completed for ${label}`);
                    
                    // Check for generated subtitle files
                    const subtitleFiles = fs.readdirSync(hlsOutputDir)
                        .filter(file => file.endsWith('.vtt'))
                        .map(file => path.join(hlsOutputDir, file));
                    
                    // Professional approach: Rename subtitle files to remove resolution prefix
                    const professionalSubtitlePaths = [];
                    for (const subtitleFile of subtitleFiles) {
                        const fileName = path.basename(subtitleFile);
                        // Remove resolution prefix (e.g., FHD_, UHD_) for professional approach
                        const cleanFileName = fileName.replace(/^(SD_|HD_|FHD_|UHD_)/, '');
                        const professionalPath = path.join(hlsOutputDir, cleanFileName);
                        
                        try {
                            // Rename the file to remove resolution prefix
                            fs.renameSync(subtitleFile, professionalPath);
                            professionalSubtitlePaths.push(professionalPath);
                            console.log(`📝 Renamed subtitle file: ${fileName} → ${cleanFileName}`);
                        } catch (renameError) {
                            console.warn(`⚠️ Could not rename subtitle file ${fileName}:`, renameError.message);
                            professionalSubtitlePaths.push(subtitleFile); // Use original path if rename fails
                        }
                    }
                    
                    subtitlePaths.push(...professionalSubtitlePaths);
                    console.log(`📝 Found ${professionalSubtitlePaths.length} professional subtitle files for ${label}:`, professionalSubtitlePaths.map(f => path.basename(f)));
                    
                    // Verify subtitle files exist and are readable
                    for (const subtitleFile of professionalSubtitlePaths) {
                        if (fs.existsSync(subtitleFile)) {
                            const stats = fs.statSync(subtitleFile);
                            console.log(`📄 Subtitle file verified: ${path.basename(subtitleFile)} (${stats.size} bytes)`);
                        } else {
                            console.warn(`⚠️ Subtitle file missing: ${subtitleFile}`);
                        }
                    }
                    
                    // Restore original working directory
                    process.chdir(originalCwd);
                    resolve({ playlistPath, subtitlePaths });
                })
                .on('error', (err) => {
                    console.error(`❌ HLS generation failed for ${label}:`, err);
                    // Restore original working directory
                    process.chdir(originalCwd);
                    reject(err);
                })
                .run();
        };

        // Execute subtitle extraction and HLS generation
        extractSubtitles()
            .then(subtitleStreams => generateHLSWithSubtitles(subtitleStreams))
            .catch(error => {
                console.warn(`⚠️ Falling back to HLS without subtitles for ${label}: ${error.message}`);
                // Fallback to basic HLS generation without subtitles
                const command = Ffmpeg(inputPath);
                command
                    .outputOptions(`-c:v libx264`)
                    .outputOptions(`-preset fast`)
                    .outputOptions(`-crf 23`)
                    .outputOptions(`-vf scale=${resolution.width}:${resolution.height}`)
                    .outputOptions(`-c:a aac`)
                    .outputOptions(`-b:a 128k`)
                    .outputOptions(`-ar 48000`) // Set audio sample rate to 48kHz for better sync
                    .outputOptions(`-ac 2`) // Stereo audio
                    .outputOptions(`-async 1`) // Audio sync correction
                    .outputOptions(`-vsync 1`) // Video sync correction
                    .outputOptions(`-f hls`)
                    .outputOptions(`-hls_time 6`)
                    .outputOptions(`-hls_list_size 0`)
                    .outputOptions(`-hls_segment_filename ${label}_${filename}_%03d.ts`)
                    .output(`${label}_${filename}.m3u8`)
                    .on('start', (commandLine) => {
                        console.log(`🚀 FFmpeg HLS fallback command for ${label}:`, commandLine);
                        broadcastProgress({
                            progress: 0,
                            clientId,
                            content: { type: 'hls_generation', resolution: label }
                        });
                    })
                    .on('progress', (progress) => {
                        if (progress.percent) {
                            broadcastProgress({
                                progress: Math.round(progress.percent),
                                clientId,
                                content: { type: 'hls_generation', resolution: label }
                            });
                        }
                    })
                    .on('end', () => {
                        console.log(`✅ HLS generation completed for ${label} (fallback)`);
                        process.chdir(originalCwd);
                        resolve({ playlistPath, subtitlePaths: [] });
                    })
                    .on('error', (err) => {
                        console.error(`❌ HLS generation failed for ${label}:`, err);
                        process.chdir(originalCwd);
                        reject(err);
                    })
                    .run();
            });
    });
};

/**
 * Generate HLS playlist and segments for a specific resolution WITHOUT subtitle extraction
 * @param {string} inputPath - Path to the original video file
 * @param {string} outputDir - Output directory for HLS files
 * @param {string} filename - Base filename
 * @param {string} label - Resolution label (SD, HD, FHD, UHD)
 * @param {string} clientId - Client ID for progress updates
 * @returns {Promise<{playlistPath: string}>} - Path to the HLS playlist
 */
const generateHLSPlaylistWithoutSubtitles = async (inputPath, outputDir, filename, label, clientId) => {
    console.log(`🎬 Generating HLS for ${label} without subtitle extraction...`);
    
    const hlsOutputDir = path.join(outputDir, `hls_${label}_${filename}`);
    fs.mkdirSync(hlsOutputDir, { recursive: true });
    
    const playlistPath = path.join(hlsOutputDir, `${label}_${filename}.m3u8`);
    
    return new Promise((resolve, reject) => {
        const resolution = resolutionsArray.find(r => r.label === label);
        if (!resolution) {
            reject(new Error(`Resolution ${label} not found`));
            return;
        }

        // Change to the output directory to avoid path issues
        const originalCwd = process.cwd();
        process.chdir(hlsOutputDir);

        // Generate HLS without subtitle extraction
        const command = Ffmpeg(inputPath);
        
        command
            .outputOptions(`-c:v libx264`)
            .outputOptions(`-preset fast`)
            .outputOptions(`-crf 23`)
            .outputOptions(`-vf scale=${resolution.width}:${resolution.height}`)
            .outputOptions(`-c:a aac`)
            .outputOptions(`-b:a 128k`)
            .outputOptions(`-ar 48000`) // Set audio sample rate to 48kHz for better sync
            .outputOptions(`-ac 2`) // Stereo audio
            .outputOptions(`-async 1`) // Audio sync correction
            .outputOptions(`-vsync 1`) // Video sync correction
            .outputOptions(`-f hls`)
            .outputOptions(`-hls_time 6`)
            .outputOptions(`-hls_list_size 0`)
            .outputOptions(`-hls_segment_filename ${label}_${filename}_%03d.ts`)
            .outputOptions(`-hls_flags independent_segments`)
            .outputOptions(`-hls_playlist_type vod`)
            .outputOptions(`-sn`) // Skip subtitle streams to avoid generating subtitle files
            .output(`${label}_${filename}.m3u8`)
            .on('start', (commandLine) => {
                console.log(`🚀 FFmpeg HLS command for ${label}:`, commandLine);
                broadcastProgress({
                    progress: 0,
                    clientId,
                    content: { type: 'hls_generation', resolution: label }
                });
            })
            .on('progress', (progress) => {
                if (progress.percent) {
                    broadcastProgress({
                        progress: Math.round(progress.percent),
                        clientId,
                        content: { type: 'hls_generation', resolution: label }
                    });
                }
            })
            .on('end', () => {
                console.log(`✅ HLS generation completed for ${label}`);
                
                // Restore original working directory
                process.chdir(originalCwd);
                resolve({ playlistPath });
            })
            .on('error', (err) => {
                console.error(`❌ HLS generation failed for ${label}:`, err);
                // Restore original working directory
                process.chdir(originalCwd);
                reject(err);
            })
            .run();
    });
};

/**
 * Generate master HLS playlist that includes all resolutions and subtitle tracks
 * @param {string} outputDir - Output directory
 * @param {string} filename - Base filename
 * @param {string} bucketName - S3 bucket name
 * @param {Array} subtitleLanguages - Array of available subtitle languages
 * @returns {Promise<string>} - Path to the master playlist
 */
const generateMasterPlaylist = async (outputDir, filename, bucketName, subtitleLanguages = []) => {
    const masterPlaylistPath = path.join(outputDir, `master_${filename}.m3u8`);
    
    let masterPlaylist = '#EXTM3U\n#EXT-X-VERSION:3\n\n';
    
    // Shared approach: Add subtitle group definition once for all resolutions
    if (subtitleLanguages.length > 0) {
        console.log(`📝 Adding subtitle group for ${subtitleLanguages.length} languages to master playlist`);
        
        subtitleLanguages.forEach(lang => {
            // Shared approach: Use shared subtitle directory for all resolutions
            const subtitleUrl = `subtitles/${filename}/${filename}_${lang}.vtt`;
            masterPlaylist += `#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",LANGUAGE="${lang}",NAME="${lang.toUpperCase()}",DEFAULT=${lang === 'en' ? 'YES' : 'NO'},URI="${subtitleUrl}"\n`;
        });
        masterPlaylist += '\n';
    }
    
    // Add video streams with subtitle references
    const resolutions = ['SD', 'HD', 'FHD', 'UHD'];
    const bandwidths = [500000, 1000000, 2000000, 4000000]; // 500k, 1M, 2M, 4M
    const videoResolutions = ['854x480', '1280x720', '1920x1080', '3840x2160'];
    
    resolutions.forEach((resolution, index) => {
        const bandwidth = bandwidths[index];
        const videoResolution = videoResolutions[index];
        const playlistUrl = `${resolution}_${filename}.m3u8`;
        
        // Shared approach: All resolutions reference the same subtitle group
        const subtitleReference = subtitleLanguages.length > 0 ? `,SUBTITLES="subs"` : '';
        
        masterPlaylist += `#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},RESOLUTION=${videoResolution}${subtitleReference}\n`;
        masterPlaylist += `${playlistUrl}\n`;
    });
    
    fs.writeFileSync(masterPlaylistPath, masterPlaylist);
    console.log(`✅ Master playlist generated with shared subtitle approach: ${masterPlaylistPath}`);
    
    return masterPlaylistPath;
};

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


/**
 * 
 * @param {spilts video in segments} param0 
 */
const splitVideoIntoSegments = async (filePath, segmentFolder, clientId, filename) => {
    return new Promise((resolve, reject) => {
        if (!fs.existsSync(segmentFolder)) {
            fs.mkdirSync(segmentFolder, { recursive: true });
        }

        const segmentListPath = path.join(segmentFolder, `${filename}_segments.txt`);

        Ffmpeg(filePath)
            .outputOptions([
              '-c:v copy', // Copy video without re-encoding
                '-c:a aac', // Encode audio as AAC for compatibility
                '-map 0:v:0', // Ensure video is included
                '-map 0:a:0?', // Include first audio track (if available)
                '-segment_time 60',
                '-f segment',
                '-g 48',
                '-sc_threshold 0',
                '-segment_format mpegts',
                '-segment_time_metadata 1',
            ])
            .addOption('-segment_list', segmentListPath) // ✅ Fix segment_list
            .output(path.join(segmentFolder, `${filename}_segment_%03d.ts`))
            .on('end', () => resolve())
            .on('progress', (progress) => {
                console.log(`Splitting progress: ${progress.percent}%`);
                io.to(clientId).emit('SplittingProgress', { 
                    progress: Math.round(progress.percent), 
                    stage: 'splitting',
                    clientId 
                });
            })
            .on('error', reject)
            .run();
    });
};

//transcode each segment
const transcodeSegment = async (inputPath, outputPath, height, clientId, label, indexNum) => {
    return new Promise((resolve, reject) => {
        Ffmpeg(inputPath)
             .videoCodec('libx264')
            .audioCodec('copy')
            .outputOptions([
                '-preset ultrafast', // Prioritize speed over compression
                '-crf 23', // Maintain a balance of quality and size
                `-vf scale='trunc(oh*a/2)*2:${height}'`, // Maintain aspect ratio
            ])
            .output(outputPath)
            .on('end', () => resolve(outputPath))
            .on('progress', (progress) => {
                let progressPercent = Math.round(progress.percent);
                if (isNaN(progressPercent) || progressPercent < 0 || progressPercent > 100) {
                    progressPercent = 0;
                }

                console.log(
                    `Transcoding segment ${label} progress: ${progress.percent}%`
                );
                io.to(clientId).emit('transcodingProgress', {
                    progress: progressPercent,
                    segmentLength: indexNum,
                    stage: `transcoding--${label}`,
                    resolution: label,
                    clientId,
                });
            })
            .on('error', reject)
            .run();

    });
};


//merge segments into final video
const mergeSegments = async (segmentFolder, finalOutputPath, clientId, label, filename) => {
    return new Promise((resolve, reject) => {
        const segmentFileList = path.join(
            segmentFolder,
            `${filename}_segments.txt`
        );
        const transcodedSegments = fs
            .readdirSync(segmentFolder)
            .filter(
                (file) =>
                    file.startsWith(`${label}_${filename}_segment_`) &&
                    file.endsWith('.ts')
            )
            .map((file) => `file '${path.join(segmentFolder, file)}'`)
            .join('\n');

        fs.writeFileSync(segmentFileList, transcodedSegments);

        Ffmpeg()
            .input(segmentFileList)
            .inputOptions(['-f concat', '-safe 0'])
            .outputOptions(['-c copy'])
            .output(finalOutputPath)
            .on('progress', (progress) => {
                console.log(
                    `Merging segments ${label} progress: ${progress.percent}%`
                );
                io.to(clientId).emit('MergeProgress', {
                    progress: Math.round(progress.percent),
                    stage: `merging-${label}`,
                    resolution: label,
                    clientId,
                });
            })
            .on('end', resolve)
            .on('error', reject)
            .run();
    });
};

const onPreTranscode2 = async (resolutions, type, resourceId) => {
    try {
        let videos = [];

        console.log('resolutions', 'checking jobs');

        if (type === 'film') {
            videos = await prisma.video.findMany({
                where: { filmId: resourceId, isTrailer: false },
                select: { id: true, resolution: true },
            });
            
        }

        if (type === 'episode') {
            videos = await prisma.video.findMany({
                where: { episodeId: resourceId, isTrailer: false },
                select: { id: true, resolution: true },
            });
        }
        console.log('resolutions', videos);

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
        throw error;
    }
};

const onUploadComplete2 = async (data, resourceId, type) => {
    let result = { ...data };

    if (type === 'film') {
        result.filmId = resourceId;
    }
    if (type === 'episode') {
        result.episodeId = resourceId;
    }

    await prisma.video.create({
        data: result,
    });
};

// Helper function to check if job is cancelled
const checkJobCancellation = async (jobId) => {
    try {
        const job = await prisma.videoProcessingJob.findFirst({
            where: { 
                jobId: jobId,
                status: 'cancelled'
            }
        });
        return !!job; // Returns true if job is cancelled
    } catch (error) {
        console.log('Error checking job cancellation:', error.message);
        return false;
    }
};

/**
 * Generate HLS playlist for trailers - single resolution, no subtitles
 * @param {string} inputPath - Path to the original trailer file
 * @param {string} outputDir - Output directory for HLS files
 * @param {string} filename - Base filename
 * @param {string} clientId - Client ID for progress updates
 * @returns {Promise<{playlistPath: string, hlsUrl: string}>} - Path to the HLS playlist and URL
 */
const generateTrailerHLS = async (inputPath, outputDir, filename, clientId) => {
    console.log(`🎬 Generating HLS for trailer: ${filename}`);
    
    const hlsOutputDir = path.join(outputDir, `hls_trailer_${filename}`);
    fs.mkdirSync(hlsOutputDir, { recursive: true });
    
    const playlistPath = path.join(hlsOutputDir, `trailer_${filename}.m3u8`);
    
    return new Promise((resolve, reject) => {
        // Use 720p HD resolution for trailers - good balance of quality and file size
        const trailerResolution = { width: 1280, height: 720, bitrate: 2500 };

        // Change to the output directory to avoid path issues
        const originalCwd = process.cwd();
        process.chdir(hlsOutputDir);

        // Generate HLS optimized for trailers
        const command = Ffmpeg(inputPath);
        
        command
            .outputOptions(`-c:v libx264`)
            .outputOptions(`-preset fast`)
            .outputOptions(`-crf 23`)
            .outputOptions(`-vf scale=${trailerResolution.width}:${trailerResolution.height}`)
            .outputOptions(`-c:a aac`)
            .outputOptions(`-b:a 128k`)
            .outputOptions(`-ar 48000`) // Set audio sample rate to 48kHz for better sync
            .outputOptions(`-ac 2`) // Stereo audio
            .outputOptions(`-async 1`) // Audio sync correction
            .outputOptions(`-vsync 1`) // Video sync correction
            .outputOptions(`-f hls`)
            .outputOptions(`-hls_time 6`) // 6-second segments for optimal streaming
            .outputOptions(`-hls_list_size 0`)
            .outputOptions(`-hls_segment_filename trailer_${filename}_%03d.ts`)
            .outputOptions(`-hls_flags independent_segments`)
            .outputOptions(`-hls_playlist_type vod`)
            .outputOptions(`-sn`) // Skip subtitle streams
            .output(`trailer_${filename}.m3u8`)
            .on('start', (commandLine) => {
                console.log(`🚀 FFmpeg HLS command for trailer:`, commandLine);
                broadcastProgress({
                    progress: 0,
                    clientId,
                    content: { type: 'trailer_hls_generation', filename }
                });
            })
            .on('progress', (progress) => {
                if (progress.percent) {
                    broadcastProgress({
                        progress: Math.round(progress.percent),
                        clientId,
                        content: { type: 'trailer_hls_generation', filename }
                    });
                }
            })
            .on('end', () => {
                console.log(`✅ Trailer HLS generation completed for ${filename}`);
                
                // Restore original working directory
                process.chdir(originalCwd);
                resolve({ playlistPath, hlsUrl: `trailer_${filename}.m3u8` });
            })
            .on('error', (err) => {
                console.error(`❌ Trailer HLS generation failed for ${filename}:`, err);
                // Restore original working directory
                process.chdir(originalCwd);
                reject(err);
            })
            .run();
    });
};

/**
 * Upload trailer HLS files to bucket
 * @param {string} hlsDir - Directory containing HLS files
 * @param {string} bucketName - S3 bucket name
 * @param {string} filename - Base filename
 * @param {string} clientId - Client ID for progress updates
 * @returns {Promise<{hlsUrl: string}>} - URL to the HLS playlist
 */
const uploadTrailerHLSToBucket = async (hlsDir, bucketName, filename, clientId) => {
    console.log(`📤 Uploading trailer HLS files to bucket: ${bucketName}`);
    
    const files = fs.readdirSync(hlsDir);
    const hlsFiles = files.filter(file => file.endsWith('.m3u8') || file.endsWith('.ts'));
    
    console.log(`📦 Found ${hlsFiles.length} HLS files to upload for trailer`);
    
    let uploadedCount = 0;
    let hlsUrl = null;
    
    for (const file of hlsFiles) {
        const filePath = path.join(hlsDir, file);
        const key = `hls_trailer/${file}`; // Store in hls/ folder in bucket
        
        try {
            const bucketParams = {
                bucketName,
                key,
                buffer: fs.createReadStream(filePath),
                contentType: file.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp2t',
                isPublic: true
            };
            
            const uploadResult = await uploadToBucket(bucketParams);
            
            if (file.endsWith('.m3u8')) {
                hlsUrl = uploadResult.url;
                console.log(`📺 Trailer HLS playlist uploaded: ${hlsUrl}`);
            }
            
            uploadedCount++;
            const progress = Math.round((uploadedCount / hlsFiles.length) * 100);
            
            broadcastProgress({
                progress,
                clientId,
                content: { type: 'trailer_hls_upload', filename }
            });
            
        } catch (error) {
            console.error(`❌ Failed to upload ${file}:`, error);
            throw error;
        }
    }
    
    console.log(`✅ All trailer HLS files uploaded successfully`);
    return { hlsUrl };
};

/**
 * Process trailer to HLS format
 * @param {Object} params - Parameters object
 * @param {string} params.filePath - Path to the original trailer file
 * @param {string} params.outputDir - Output directory for processing
 * @param {string} params.filename - Base filename
 * @param {string} params.bucketName - S3 bucket name
 * @param {string} params.clientId - Client ID for progress updates
 * @returns {Promise<{hlsUrl: string, size: string, duration: string}>} - HLS URL and metadata
 */
export const processTrailerToHLS = async ({ filePath, outputDir, filename, bucketName, clientId }) => {
    try {
        console.log(`🎬 Starting trailer HLS processing for: ${filename}`);
        
        // Get video metadata
        const metadata = await new Promise((resolve, reject) => {
            Ffmpeg(filePath).ffprobe((err, data) => {
                if (err) reject(err);
                else resolve(data.format);
            });
        });
        
        console.log(`📊 Trailer metadata:`, {
            duration: metadata.duration,
            size: metadata.size,
            bitrate: metadata.bit_rate
        });
        
        // Generate HLS files
        broadcastProgress({
            progress: 10,
            clientId,
            content: { type: 'trailer_processing', stage: 'hls_generation' }
        });
        
        const { playlistPath } = await generateTrailerHLS(filePath, outputDir, filename, clientId);
        
        // Upload HLS files to bucket
        broadcastProgress({
            progress: 60,
            clientId,
            content: { type: 'trailer_processing', stage: 'uploading' }
        });
        
        const hlsDir = path.dirname(playlistPath);
        const { hlsUrl } = await uploadTrailerHLSToBucket(hlsDir, bucketName, filename, clientId);
        
        // Clean up local HLS files
        broadcastProgress({
            progress: 90,
            clientId,
            content: { type: 'trailer_processing', stage: 'cleanup' }
        });
        
        fs.rmSync(hlsDir, { recursive: true, force: true });
        
        broadcastProgress({
            progress: 100,
            clientId,
            content: { type: 'trailer_processing', stage: 'completed' }
        });
        
        console.log(`✅ Trailer HLS processing completed: ${hlsUrl}`);
        
        return {
            hlsUrl,
            size: formatFileSize(metadata.size),
            duration: Math.round(metadata.duration)
        };
        
    } catch (error) {
        console.error(`❌ Trailer HLS processing failed:`, error);
        throw error;
    }
};


export async function transcodeVideo2({
    type,
    filePath,
    resourceId,
    resource,
    fileName,
    filename,
    outputDir,
    clientId,
    bucketName,
    jobId,
}) {
    
    if (onPreTranscode2) {
        RESOLUTIONS = await onPreTranscode2(RESOLUTIONS, type, resourceId);
    }

    // Check for cancellation before starting
    if (await checkJobCancellation(jobId)) {
        throw new Error('Job was cancelled before processing started');
    }

    const initialMetadata = await new Promise((resolve, reject) => {
        Ffmpeg(filePath).ffprobe((err, data) => {
            if (err) reject(err);
            else resolve(data.format);
        });
    });

    // STEP 1: Extract subtitle information BEFORE transcoding starts
    console.log('📝 Extracting subtitle information before transcoding...');
    const subtitleInfo = await new Promise((resolve, reject) => {
        Ffmpeg(filePath).ffprobe((err, metadata) => {
            if (err) {
                console.warn('⚠️ Could not extract subtitle metadata:', err.message);
                resolve({ subtitleStreams: [], subtitleLanguages: [], subtitleTypes: [] });
                return;
            }
            
            // More comprehensive subtitle detection - look for ALL subtitle streams
            const subtitleStreams = metadata.streams.filter(stream => 
                stream.codec_type === 'subtitle'
            );
            
            console.log(`📝 Found ${subtitleStreams.length} subtitle streams:`, 
                subtitleStreams.map(s => ({ 
                    index: s.index, 
                    language: s.tags?.language || s.tags?.title || 'Unknown', 
                    codec: s.codec_name,
                    disposition: s.disposition
                }))
            );
            
            const subtitleLanguages = subtitleStreams.map(stream => 
                stream.tags?.language || stream.tags?.title || `subtitle_${stream.index}`
            );
            
            const subtitleTypes = subtitleStreams.map(stream => stream.codec_name);
            
            console.log(`📝 Subtitle languages:`, subtitleLanguages);
            console.log(`📝 Subtitle types:`, subtitleTypes);
            resolve({ subtitleStreams, subtitleLanguages, subtitleTypes });
        });
    });

    // STEP 2: Extract and save subtitles BEFORE transcoding
    const extractedSubtitlePaths = [];
    if (subtitleInfo.subtitleStreams.length > 0) {
        console.log('📝 Extracting subtitle files before transcoding...');
        
        // Create subtitle directory with proper structure
        const subtitleDir = path.join(outputDir, 'subtitles', filename);
        fs.mkdirSync(subtitleDir, { recursive: true });
        
        // Extract each subtitle track
        for (let i = 0; i < subtitleInfo.subtitleStreams.length; i++) {
            const stream = subtitleInfo.subtitleStreams[i];
            const language = subtitleInfo.subtitleLanguages[i];
            const subtitleType = subtitleInfo.subtitleTypes[i];
            
            // Check for cancellation before each subtitle extraction
            if (await checkJobCancellation(jobId)) {
                throw new Error('Job was cancelled during subtitle extraction');
            }
            
            try {
                const subtitlePath = await new Promise((resolve, reject) => {
                    // Create a clean filename for the subtitle
                    const cleanLanguage = language.replace(/[^a-zA-Z0-9]/g, '_');
                    const outputSubtitlePath = path.join(subtitleDir, `${filename}_${cleanLanguage}.vtt`);
                    
                    console.log(`📝 Extracting subtitle ${i + 1}/${subtitleInfo.subtitleStreams.length}: ${language} (${subtitleType})`);
                    
                    const ffmpegCommand = Ffmpeg(filePath);
                    
                    // Handle different subtitle codecs
                    if (subtitleType === 'webvtt') {
                        // Already in WebVTT format, just extract
                        ffmpegCommand
                            .outputOptions([`-map 0:s:${i}`, '-c:s copy'])
                            .output(outputSubtitlePath);
                    } else {
                        // Convert to WebVTT format
                        ffmpegCommand
                            .outputOptions([`-map 0:s:${i}`, '-c:s webvtt'])
                            .output(outputSubtitlePath);
                    }
                    
                    ffmpegCommand
                        .on('end', () => {
                            console.log(`✅ Extracted subtitle: ${language} → ${path.basename(outputSubtitlePath)}`);
                            resolve(outputSubtitlePath);
                        })
                        .on('error', (err) => {
                            console.warn(`⚠️ Failed to extract subtitle ${language}:`, err.message);
                            reject(err);
                        })
                        .run();
                });
                
                extractedSubtitlePaths.push({
                    path: subtitlePath,
                    language: language,
                    type: subtitleType
                });
                
            } catch (error) {
                console.warn(`⚠️ Skipping subtitle extraction for ${language}:`, error.message);
            }
        }
        
        console.log(`✅ Extracted ${extractedSubtitlePaths.length} subtitle files to: ${subtitleDir}`);
    } else {
        // Fallback: Check if there are any existing subtitle files in the output directory
        console.log('📝 No subtitle streams detected, checking for existing subtitle files...');
        
        // Create subtitle directory with proper structure
        const subtitleDir = path.join(outputDir, 'subtitles', filename);
        fs.mkdirSync(subtitleDir, { recursive: true });
        
        // Look for any .vtt files that might have been generated
        const outputDirContents = fs.readdirSync(outputDir, { withFileTypes: true });
        const vttFiles = outputDirContents
            .filter(item => item.isFile() && item.name.endsWith('.vtt'))
            .map(item => path.join(outputDir, item.name));
        
        if (vttFiles.length > 0) {
            console.log(`📝 Found ${vttFiles.length} existing subtitle files:`, vttFiles.map(f => path.basename(f)));
            
            for (let i = 0; i < vttFiles.length; i++) {
                const vttFile = vttFiles[i];
                const fileName = path.basename(vttFile);
                
                // Create a clean filename for the subtitle
                const cleanFileName = fileName.replace(/^(SD_|HD_|FHD_|UHD_)/, ''); // Remove resolution prefix
                const newSubtitlePath = path.join(subtitleDir, cleanFileName);
                
                try {
                    // Move the subtitle file to the proper location
                    fs.renameSync(vttFile, newSubtitlePath);
                    console.log(`✅ Moved subtitle file: ${fileName} → ${cleanFileName}`);
                    
                    extractedSubtitlePaths.push({
                        path: newSubtitlePath,
                        language: cleanFileName.replace('.vtt', ''),
                        type: 'webvtt'
                    });
                } catch (error) {
                    console.warn(`⚠️ Failed to move subtitle file ${fileName}:`, error.message);
                }
            }
            
            console.log(`✅ Moved ${extractedSubtitlePaths.length} subtitle files to: ${subtitleDir}`);
        }
    }

    // STEP 3: Save subtitle information to database
    if (subtitleInfo.subtitleLanguages.length > 0) {
        try {
            if (type === 'film') {
                await prisma.film.update({
                    where: { id: resourceId },
                    data: {
                        subtitleLanguage: subtitleInfo.subtitleLanguages,
                        embeddedSubtitles: true,
                    }
                });
            } else if (type === 'episode') {
                await prisma.episode.update({
                    where: { id: resourceId },
                    data: {
                        subtitleLanguage: subtitleInfo.subtitleLanguages,
                        embeddedSubtitles: true,
                    }
                });
            }
            console.log(`✅ Updated ${type} with subtitle information:`, {
                languages: subtitleInfo.subtitleLanguages,
                types: subtitleInfo.subtitleTypes
            });
        } catch (error) {
            console.warn(`⚠️ Failed to update ${type} with subtitle info:`, error.message);
        }
    }

    try {
        console.log('🚀 Starting HLS transcoding with shared subtitle approach...');
        
        // STEP 4: Generate HLS playlists for each resolution (without subtitle extraction)
        const hlsPlaylists = [];
        
        for (const [label, height] of Object.entries(RESOLUTIONS)) {
            console.log(`🎬 Processing ${label} resolution...`);

            // Check for cancellation before each resolution
            if (await checkJobCancellation(jobId)) {
                // Clean up any created HLS files
                for (const playlist of hlsPlaylists) {
                    if (fs.existsSync(playlist.playlistPath)) {
                        fs.rmSync(path.dirname(playlist.playlistPath), { recursive: true, force: true });
                    }
                }
                // Clean up subtitle directory
                const subtitleDir = path.join(outputDir, 'subtitles', filename);
                if (fs.existsSync(subtitleDir)) {
                    fs.rmSync(subtitleDir, { recursive: true, force: true });
                }
                // Clean up original file
                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                }
                throw new Error(`Job was cancelled during ${label} processing`);
            }

            try {
                // Generate HLS without subtitle extraction (since we already extracted them)
                const result = await generateHLSPlaylistWithoutSubtitles(filePath, outputDir, filename, label, clientId);
                hlsPlaylists.push(result);
                
                // Check for cancellation before upload
                if (await checkJobCancellation(jobId)) {
                    // Clean up created HLS files
                    for (const playlist of hlsPlaylists) {
                        if (fs.existsSync(playlist.playlistPath)) {
                            fs.rmSync(path.dirname(playlist.playlistPath), { recursive: true, force: true });
                        }
                    }
                    // Clean up subtitle directory
                    const subtitleDir = path.join(outputDir, 'subtitles', filename);
                    if (fs.existsSync(subtitleDir)) {
                        fs.rmSync(subtitleDir, { recursive: true, force: true });
                    }
                    // Clean up original file
                    if (fs.existsSync(filePath)) {
                        fs.unlinkSync(filePath);
                    }
                    throw new Error(`Job was cancelled before uploading ${label}`);
                }

                // Step 5: Upload HLS files to DigitalOcean Spaces
                console.log(`📤 Adding HLS upload job for ${label}...`);
                await hlsUploadQueue.add("upload-hls-to-s3", {
                    hlsDir: path.dirname(result.playlistPath),
                    label,
                    filename,
                    resourceId,
                    bucketName,
                    clientId,
                    type,
                    initialMetadata,
                    subtitlePaths: [], // No resolution-specific subtitles
                });
                console.log(`✅ HLS upload job added for ${label}`);

                console.log(`✅ Finished processing ${label}`);
            } catch (error) {
                console.error(`❌ Error processing ${label}:`, error);
                throw error;
            }
        }

        // STEP 6: Upload extracted subtitle files separately (shared approach)
        if (extractedSubtitlePaths.length > 0) {
            console.log(`📤 Uploading ${extractedSubtitlePaths.length} subtitle files using shared approach...`);
            
            for (const subtitleInfo of extractedSubtitlePaths) {
                if (await checkJobCancellation(jobId)) {
                    throw new Error('Job was cancelled during subtitle upload');
                }
                
                // Verify the subtitle file exists before queuing upload
                if (!fs.existsSync(subtitleInfo.path)) {
                    console.warn(`⚠️ Subtitle file not found, skipping: ${subtitleInfo.path}`);
                    continue;
                }
                
                try {
                    // Create subtitle metadata for database creation
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
                    
                    const subtitleLabel = languageNames[subtitleInfo.language] || subtitleInfo.language.toUpperCase();
                    
                    const subtitleMetadata = {
                        filename: path.basename(subtitleInfo.path),
                        language: subtitleInfo.language,
                        label: subtitleLabel,
                        fileSize: fs.statSync(subtitleInfo.path).size
                    };
                    
                    await hlsUploadQueue.add("upload-subtitle-to-s3", {
                        subtitlePath: subtitleInfo.path,
                        filename,
                        resourceId,
                        bucketName,
                        clientId,
                        type,
                        // Shared approach: Upload to shared subtitle directory
                        uploadPath: `subtitles/${filename}/`,
                        subtitleMetadata // Pass metadata for database creation
                    });
                    console.log(`✅ Queued subtitle upload: ${subtitleInfo.language} (${subtitleInfo.type}) - Label: ${subtitleLabel}`);
                } catch (error) {
                    console.warn(`⚠️ Failed to queue subtitle upload ${subtitleInfo.path}:`, error.message);
                }
            }
        } else {
            console.log(`📝 No subtitle files found to upload`);
        }

        // STEP 7: Generate and upload master playlist with subtitle information
        if (await checkJobCancellation(jobId)) {
            // Clean up created HLS files
            for (const playlist of hlsPlaylists) {
                if (fs.existsSync(playlist.playlistPath)) {
                    fs.rmSync(path.dirname(playlist.playlistPath), { recursive: true, force: true });
                }
            }
            // Clean up subtitle directory
            const subtitleDir = path.join(outputDir, 'subtitles', filename);
            if (fs.existsSync(subtitleDir)) {
                fs.rmSync(subtitleDir, { recursive: true, force: true });
            }
            // Clean up original file
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
            throw new Error('Job was cancelled before generating master playlist');
        }

        const masterPlaylistPath = await generateMasterPlaylist(
            outputDir, 
            filename, 
            bucketName, 
            subtitleInfo.subtitleLanguages
        );
        
        // Upload master playlist
        console.log(`📤 Adding master playlist upload job...`);
        await masterPlaylistQueue.add("upload-master-playlist", {
            masterPlaylistPath,
            filename,
            resourceId,
            bucketName,
            clientId,
            type,
            subtitleLanguages: subtitleInfo.subtitleLanguages,
        });
        console.log(`✅ Master playlist upload job added`);

        // Note: Don't clean up subtitle directory here - let the upload workers handle cleanup
        // The subtitle directory will be cleaned up by the upload workers after successful upload
        
        // Only remove the original video file
        if (fs.existsSync(filePath)) {
         fs.unlinkSync(filePath);
        }
         console.log("🗑️ Original video deleted");

        console.log('✅ All HLS streams generated with shared subtitle approach and queued for upload.');
    } catch (error) {
        // Clean up on any error
        try {
            // Clean up any created HLS directories
            for (const resolution of Object.keys(RESOLUTIONS)) {
                const hlsDir = path.join(outputDir, `hls_${resolution}_${filename}`);
                if (fs.existsSync(hlsDir)) {
                    fs.rmSync(hlsDir, { recursive: true, force: true });
                }
            }
            
            // Clean up subtitle directory
            const subtitleDir = path.join(outputDir, 'subtitles', filename);
            if (fs.existsSync(subtitleDir)) {
                fs.rmSync(subtitleDir, { recursive: true, force: true });
            }
            
            // Clean up master playlist
            const masterPlaylistPath = path.join(outputDir, `master_${filename}.m3u8`);
            if (fs.existsSync(masterPlaylistPath)) {
                fs.unlinkSync(masterPlaylistPath);
            }
            
            // Clean up original file
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        } catch (cleanupError) {
            console.error('Error during cleanup:', cleanupError.message);
        }
        throw error;
    }
}

/**
 * Upload HLS directory (playlist + segments) to DigitalOcean Spaces without subtitle handling
 */
export async function uploadHLSToDO({
    hlsDir,
    label,
    filename,
    resourceId,
    bucketName,
    clientId,
    type,
    initialMetadata,
    subtitlePaths = [] // Not used in new approach, kept for backward compatibility
}) {
    try {
        console.log(`📤 Uploading HLS files for ${label}...`);
        
        // List all files in the HLS directory
        const files = fs.readdirSync(hlsDir);
        console.log(`📄 Files in HLS directory: ${files.join(', ')}`);
        
        // Find the playlist file (.m3u8)
        const playlistFile = files.find(file => file.endsWith('.m3u8'));
        if (!playlistFile) {
            throw new Error('No playlist file found in HLS directory');
        }
        
        const playlistPath = path.join(hlsDir, playlistFile);
        
        // Note: In the new approach, subtitles are uploaded separately and referenced in the master playlist
        // Individual resolution playlists don't need subtitle references
        
        const playlistStream = fs.createReadStream(playlistPath);
        
        // Upload playlist with public-read permissions
        const playlistParams = {
            bucketName,
            key: `hls_${label}_${filename}/${playlistFile}`,
            buffer: playlistStream,
            contentType: 'application/vnd.apple.mpegurl',
            isPublic: true, // Set to public-read
        };

        const playlistData = await uploadToBucket(playlistParams, (progress) => {
            io.to(clientId).emit('uploadProgress', {
                progress,
                content: {
                    type,
                    resolution: label,
                    fileType: 'playlist'
                },
                clientId,
            });
        });

        console.log(`✅ Playlist uploaded: ${playlistData.url}`);
        
        // Upload all segment files (.ts) with public-read permissions
        const segmentFiles = files.filter(file => file.endsWith('.ts'));
        console.log(`📤 Uploading ${segmentFiles.length} segments...`);
        
        for (let i = 0; i < segmentFiles.length; i++) {
            const segmentFile = segmentFiles[i];
            const segmentPath = path.join(hlsDir, segmentFile);
            const segmentStream = fs.createReadStream(segmentPath);
            
            const segmentParams = {
                bucketName,
                key: `hls_${label}_${filename}/${segmentFile}`,
                buffer: segmentStream,
                contentType: 'video/mp2t',
                isPublic: true, // Set to public-read
            };

            await uploadToBucket(segmentParams, (progress) => {
                io.to(clientId).emit('uploadProgress', {
                    progress,
                    content: {
                        type,
                        resolution: label,
                        fileType: 'segment',
                        segment: segmentFile
                    },
                    clientId,
                });
            });
            console.log(`✅ Segment ${segmentFile} uploaded successfully`);
        }

        // Note: Subtitle files are uploaded separately in the new approach
        // They are not included in the HLS directory upload

        // Use the initialMetadata that was passed to the function instead of reading the original file
        const metadata = initialMetadata || { size: 0, duration: 0, bit_rate: 0 };

        const videoData = {
            resolution: label,
            name: playlistFile,
            format: 'application/vnd.apple.mpegurl',
            url: playlistData.url, // HLS streaming URL
            hlsUrl: playlistData.url, // HLS streaming URL
            encoding: 'libx264',
            size: metadata.size?.toString() || '0',
            duration: metadata.duration || 0,
            bitrate: formatBitrate(metadata.bit_rate ?? 0),
        };

        console.log('HLS videoData:', videoData);
        
        // Save to database
        if (onUploadComplete2) {
            await onUploadComplete2(videoData, resourceId, type);
        }

        // Clean up local HLS files after successful upload
        try {
            fs.rmSync(hlsDir, { recursive: true, force: true });
            console.log(`🗑️ Cleaned up local HLS directory: ${hlsDir}`);
        } catch (cleanupError) {
            console.warn(`⚠️ Could not clean up HLS directory ${hlsDir}:`, cleanupError.message);
        }

        console.log(`✅ HLS upload completed for ${label}`);
        
    } catch (error) {
        console.error('HLS upload error:', error);
        throw error;
    }
}

/**
 * Upload subtitle file to DigitalOcean Spaces
 */
export async function uploadSubtitleToDO({
    subtitlePath,
    filename,
    resourceId,
    bucketName,
    clientId,
    type,
    uploadPath = null, // Allow custom upload path for shared approach
    subtitleId = null, // For existing subtitle records
    subtitleMetadata = null, // For creating new subtitle records
}) {
    try {
        console.log(`📤 Uploading subtitle file: ${path.basename(subtitlePath)}`);
        console.log(`📁 Full subtitle path: ${subtitlePath}`);
        
        if (!fs.existsSync(subtitlePath)) {
            console.warn(`⚠️ Subtitle file not found: ${subtitlePath}`);
            console.warn(`⚠️ Current working directory: ${process.cwd()}`);
            console.warn(`⚠️ Directory contents:`, fs.readdirSync(path.dirname(subtitlePath) || '.'));
            return;
        }
        
        // Verify file is readable
        const stats = fs.statSync(subtitlePath);
        console.log(`📄 Subtitle file stats: ${stats.size} bytes, last modified: ${stats.mtime}`);
        
        const subtitleStream = fs.createReadStream(subtitlePath);
        const subtitleFileName = path.basename(subtitlePath);
        
        // Shared approach: Use shared subtitle directory for all resolutions
        const subtitleKey = uploadPath 
            ? `${uploadPath}${subtitleFileName}`
            : `subtitles/${filename}/${subtitleFileName}`;
        
        console.log(`📤 Uploading to DigitalOcean path: ${subtitleKey}`);
        
        const subtitleParams = {
            bucketName,
            key: subtitleKey,
            buffer: subtitleStream,
            contentType: 'text/vtt',
            isPublic: true,
        };

        const subtitleData = await uploadToBucket(subtitleParams, (progress) => {
            io.to(clientId).emit('uploadProgress', {
                progress,
                content: {
                    type,
                    fileType: 'subtitle',
                    subtitle: subtitleFileName
                },
                clientId,
            });
        });

        console.log(`✅ Subtitle uploaded: ${subtitleData.url}`);
        console.log(`📁 Shared subtitle path: ${subtitleKey}`);
        
        // Handle database operations
        let finalSubtitleId = subtitleId;
        
        if (subtitleMetadata && !subtitleId) {
            // Create new subtitle record
            try {
                const { default: prisma } = await import('@/utils/db.mjs');
                const newSubtitle = await prisma.subtitle.create({
                    data: {
                        filename: subtitleMetadata.filename,
                        language: subtitleMetadata.language,
                        label: subtitleMetadata.label, // Add label field
                        resourceId: resourceId,
                        resourceType: type,
                        filePath: null, // No file path for memory storage
                        fileSize: subtitleMetadata.fileSize,
                        s3Url: subtitleData.url
                    }
                });
                finalSubtitleId = newSubtitle.id;
                console.log(`💾 Created new subtitle record in database: ${finalSubtitleId}`);
            } catch (dbError) {
                console.error('❌ Error creating subtitle record in database:', dbError);
                // Don't throw error as the upload was successful
            }
        } else if (subtitleId) {
            // Update existing subtitle record
            try {
                const { default: prisma } = await import('@/utils/db.mjs');
                const updateData = {
                    s3Url: subtitleData.url
                };
                
                // Add label to update if provided in metadata
                if (subtitleMetadata && subtitleMetadata.label) {
                    updateData.label = subtitleMetadata.label;
                }
                
                await prisma.subtitle.update({
                    where: { id: subtitleId },
                    data: updateData
                });
                console.log(`💾 Updated subtitle record in database with S3 URL: ${subtitleId}`);
            } catch (dbError) {
                console.error('❌ Error updating subtitle record in database:', dbError);
                // Don't throw error as the upload was successful
            }
        }
        
        // Clean up local subtitle file after successful upload
        try {
            fs.unlinkSync(subtitlePath);
            console.log(`🗑️ Cleaned up local subtitle file: ${subtitlePath}`);
            
            // Check if this was the last subtitle file in the directory
            const subtitleDir = path.dirname(subtitlePath);
            const remainingFiles = fs.readdirSync(subtitleDir);
            
            // If no more files in the subtitle directory, remove the entire directory
            if (remainingFiles.length === 0) {
                fs.rmdirSync(subtitleDir);
                console.log(`🗑️ Cleaned up empty subtitle directory: ${subtitleDir}`);
            }
        } catch (cleanupError) {
            console.warn(`⚠️ Could not clean up subtitle file ${subtitlePath}:`, cleanupError.message);
        }

        console.log(`✅ Subtitle upload completed: ${subtitleFileName}`);
        
        // Return the subtitle ID for reference
        return { subtitleId: finalSubtitleId, s3Url: subtitleData.url };
        
    } catch (error) {
        console.error('Subtitle upload error:', error);
        console.error('Error details:', {
            subtitlePath,
            filename,
            resourceId,
            bucketName,
            uploadPath,
            subtitleId,
            subtitleMetadata,
            errorMessage: error.message,
            errorStack: error.stack
        });
        throw error;
    }
}

/**
 * Upload master playlist to DigitalOcean Spaces with subtitle support
 */
export async function uploadMasterPlaylist({
    masterPlaylistPath,
    filename,
    resourceId,
    bucketName,
    clientId,
    type,
    subtitleLanguages = [],
}) {
    try {
        console.log('📤 Uploading master playlist with shared subtitle approach...');
        
        const playlistStream = fs.createReadStream(masterPlaylistPath);
        
        const playlistParams = {
            bucketName,
            key: `master_${filename}.m3u8`,
            buffer: playlistStream,
            contentType: 'application/vnd.apple.mpegurl',
            isPublic: true, // Set to public-read
        };

        const playlistData = await uploadToBucket(playlistParams, (progress) => {
            io.to(clientId).emit('uploadProgress', {
                progress,
                content: {
                    type,
                    fileType: 'master_playlist',
                    subtitleCount: subtitleLanguages.length
                },
                clientId,
            });
        });

        console.log('✅ Master playlist uploaded:', playlistData.url);
        
        // Save master playlist URL to database with subtitle information
        const masterPlaylistData = {
            resolution: 'MASTER',
            name: `master_${filename}.m3u8`,
            format: 'application/vnd.apple.mpegurl',
            url: playlistData.url,
            hlsUrl: playlistData.url,
            encoding: 'libx264',
            size: '0',
            duration: 0,
            bitrate: '0',
        };

        if (onUploadComplete2) {
            await onUploadComplete2(masterPlaylistData, resourceId, type);
        }

        // Clean up local master playlist file after successful upload
        try {
            fs.unlinkSync(masterPlaylistPath);
            console.log(`🗑️ Cleaned up local master playlist: ${masterPlaylistPath}`);
        } catch (cleanupError) {
            console.warn(`⚠️ Could not clean up master playlist ${masterPlaylistPath}:`, cleanupError.message);
        }

        console.log(`✅ Master playlist upload completed with ${subtitleLanguages.length} subtitle languages (shared approach)`);
        
    } catch (error) {
        console.error('Master playlist upload error:', error);
        throw error;
    }
}

// Keep the old function for backward compatibility but mark as deprecated
export async function uploadtoDO({
    mergedFilePath,
    label,
    filename,
    resourceId,
    bucketName,
    clientId,
    type,
    initialMetadata
}){
    console.warn('⚠️ uploadtoDO is deprecated. Use uploadHLSToDO instead.');
    
    const ffstream = fs.createReadStream(mergedFilePath);
    const name = `${label}_${filename}.mp4`;
    const bucketParams = {
      bucketName,
      key: name,
      buffer: ffstream,
      contentType: 'video/mp4',
      isPublic: true,
  };

  await  uploadToBucket(bucketParams, (progress) => {
      io.to(clientId).emit('uploadProgress', {
          progress,
          content: {
              type,
              resolution: label,
          },
          clientId,
      });
  }).then(async (data) => {
      // ffprobe the transcoded stream
      const finalMetadata = await new Promise(
          (resolve, reject) => {
              Ffmpeg(mergedFilePath).ffprobe(
                  (err, data) => {
                      if (err) reject(err);
                      else resolve(data.format);
                  }
              );
          }
      );

      let metadata = {
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

      console.log('videoData',videoData);
       // callback function to handle the completion
       if (onUploadComplete2) {
         await onUploadComplete2(videoData, resourceId, type);
      }

      // remove the local copy of the video after uploading it to s3
      await fs.promises.rm(mergedFilePath);
      
  })
  .catch((uploadError) => 
 console.log('upload error',uploadError)
  );
}