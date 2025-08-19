import Ffmpeg from 'fluent-ffmpeg';
import fs from 'fs';
import path from 'path';
import { io } from '@/utils/sockets.js';

/**
 * Generate DASH stream from video file
 */
export const generateDASHStream = async (inputPath, outputDir, filename, label, clientId) => {
    console.log(`🎬 Generating DASH for ${label}...`);
    
    const dashOutputDir = path.join(outputDir, `dash_${label}_${filename}`);
    fs.mkdirSync(dashOutputDir, { recursive: true });
    
    const manifestPath = path.join(dashOutputDir, `${label}_${filename}.mpd`);
    
    return new Promise((resolve, reject) => {
        const command = Ffmpeg(inputPath);
        
        // DASH configuration for optimal streaming
        command
            .outputOptions('-c:v libx264')
            .outputOptions('-preset fast')
            .outputOptions('-crf 23')
            .outputOptions('-c:a aac')
            .outputOptions('-b:a 128k')
            .outputOptions('-f dash')
            .outputOptions('-seg_duration 6')
            .outputOptions('-use_template 1')
            .outputOptions('-use_timeline 1')
            .outputOptions('-init_seg_name init-$RepresentationID$.m4s')
            .outputOptions('-media_seg_name chunk-$RepresentationID$-$Number%05d$.m4s')
            .outputOptions('-adaptation_sets "id=0,streams=v id=1,streams=a"')
            .output(manifestPath)
            .on('start', (commandLine) => {
                console.log(`🚀 FFmpeg DASH command for ${label}:`, commandLine);
                broadcastProgress({
                    progress: 0,
                    clientId,
                    content: { type: 'dash_generation', resolution: label }
                });
            })
            .on('progress', (progress) => {
                if (progress.percent) {
                    broadcastProgress({
                        progress: Math.round(progress.percent),
                        clientId,
                        content: { type: 'dash_generation', resolution: label }
                    });
                }
            })
            .on('end', () => {
                console.log(`✅ DASH generation completed for ${label}`);
                resolve(manifestPath);
            })
            .on('error', (err) => {
                console.error(`❌ DASH generation failed for ${label}:`, err);
                reject(err);
            })
            .run();
    });
};

/**
 * Generate multi-resolution DASH stream
 */
export const generateMultiResolutionDASH = async (inputPath, outputDir, filename, clientId) => {
    console.log(`🎬 Generating multi-resolution DASH...`);
    
    const dashOutputDir = path.join(outputDir, `dash_multi_${filename}`);
    fs.mkdirSync(dashOutputDir, { recursive: true });
    
    const manifestPath = path.join(dashOutputDir, `${filename}.mpd`);
    
    return new Promise((resolve, reject) => {
        const command = Ffmpeg(inputPath);
        
        // Multi-resolution DASH configuration
        command
            .outputOptions('-c:v libx264')
            .outputOptions('-preset fast')
            .outputOptions('-crf 23')
            .outputOptions('-c:a aac')
            .outputOptions('-b:a 128k')
            .outputOptions('-f dash')
            .outputOptions('-seg_duration 6')
            .outputOptions('-use_template 1')
            .outputOptions('-use_timeline 1')
            .outputOptions('-init_seg_name init-$RepresentationID$.m4s')
            .outputOptions('-media_seg_name chunk-$RepresentationID$-$Number%05d$.m4s')
            .outputOptions('-adaptation_sets "id=0,streams=v id=1,streams=a"')
            // Multiple resolutions
            .outputOptions('-vf scale=854:480:force_original_aspect_ratio=decrease')
            .outputOptions('-b:v 800k')
            .outputOptions('-maxrate 856k')
            .outputOptions('-bufsize 1200k')
            .outputOptions('-vf scale=1280:720:force_original_aspect_ratio=decrease')
            .outputOptions('-b:v 2500k')
            .outputOptions('-maxrate 2675k')
            .outputOptions('-bufsize 3750k')
            .outputOptions('-vf scale=1920:1080:force_original_aspect_ratio=decrease')
            .outputOptions('-b:v 5000k')
            .outputOptions('-maxrate 5350k')
            .outputOptions('-bufsize 7500k')
            .output(manifestPath)
            .on('start', (commandLine) => {
                console.log(`🚀 FFmpeg Multi-DASH command:`, commandLine);
                broadcastProgress({
                    progress: 0,
                    clientId,
                    content: { type: 'dash_generation', resolution: 'multi' }
                });
            })
            .on('progress', (progress) => {
                if (progress.percent) {
                    broadcastProgress({
                        progress: Math.round(progress.percent),
                        clientId,
                        content: { type: 'dash_generation', resolution: 'multi' }
                    });
                }
            })
            .on('end', () => {
                console.log(`✅ Multi-resolution DASH generation completed`);
                resolve(manifestPath);
            })
            .on('error', (err) => {
                console.error(`❌ Multi-resolution DASH generation failed:`, err);
                reject(err);
            })
            .run();
    });
};

/**
 * Upload DASH files to DigitalOcean Spaces
 */
export const uploadDASHToDO = async ({
    dashDir,
    filename,
    resourceId,
    bucketName,
    clientId,
    type,
    initialMetadata
}) => {
    try {
        console.log(`📤 Uploading DASH files...`);
        
        // List all files in the DASH directory
        const files = fs.readdirSync(dashDir);
        console.log(`📄 Files in DASH directory: ${files.join(', ')}`);
        
        // Find the manifest file (.mpd)
        const manifestFile = files.find(file => file.endsWith('.mpd'));
        if (!manifestFile) {
            throw new Error('No manifest file found in DASH directory');
        }
        
        const manifestPath = path.join(dashDir, manifestFile);
        const manifestStream = fs.createReadStream(manifestPath);
        
        // Upload manifest with public-read permissions
        const manifestParams = {
            bucketName,
            key: `${resourceId}/dash_${filename}/${manifestFile}`,
            buffer: manifestStream,
            contentType: 'application/dash+xml',
            isPublic: true,
        };

        const { uploadToBucket } = await import('./s3.js');
        const manifestData = await uploadToBucket(manifestParams);
        console.log(`✅ Manifest uploaded: ${manifestData.url}`);
        
        // Upload all segment files (.m4s)
        const segmentFiles = files.filter(file => file.endsWith('.m4s'));
        console.log(`📤 Uploading ${segmentFiles.length} segments...`);
        
        for (let i = 0; i < segmentFiles.length; i++) {
            const segmentFile = segmentFiles[i];
            const segmentPath = path.join(dashDir, segmentFile);
            const segmentStream = fs.createReadStream(segmentPath);
            
            const segmentParams = {
                bucketName,
                key: `${resourceId}/dash_${filename}/${segmentFile}`,
                buffer: segmentStream,
                contentType: 'video/mp4',
                isPublic: true,
            };

            await uploadToBucket(segmentParams);
            console.log(`✅ Segment ${segmentFile} uploaded successfully`);
        }

        // Use the initialMetadata that was passed to the function
        const metadata = initialMetadata || { size: 0, duration: 0, bit_rate: 0 };

        const videoData = {
            resolution: 'DASH',
            name: manifestFile,
            format: 'application/dash+xml',
            url: manifestData.url,
            dashUrl: manifestData.url,
            encoding: 'libx264',
            size: metadata.size?.toString() || '0',
            duration: metadata.duration || 0,
            bitrate: formatBitrate(metadata.bit_rate ?? 0),
        };

        console.log('DASH videoData:', videoData);
        
        // Clean up local DASH files after successful upload
        try {
            fs.rmSync(dashDir, { recursive: true, force: true });
            console.log(`🗑️ Cleaned up local DASH directory: ${dashDir}`);
        } catch (cleanupError) {
            console.warn(`⚠️ Could not clean up DASH directory ${dashDir}:`, cleanupError.message);
        }

        console.log(`✅ DASH upload completed`);
        return videoData;
        
    } catch (error) {
        console.error('DASH upload error:', error);
        throw error;
    }
};

// Helper function to format bitrate
const formatBitrate = (bitrate) => {
    if (!bitrate) return '0 kbps';
    const kbps = Math.round(bitrate / 1000);
    if (kbps >= 1000) {
        return `${(kbps / 1000).toFixed(1)} Mbps`;
    }
    return `${kbps} kbps`;
};

// Helper function to broadcast progress
const broadcastProgress = ({ progress, clientId, content }) => {
    io.to(clientId).emit('transcodingProgress', {
        progress,
        content,
        clientId,
    });
}; 