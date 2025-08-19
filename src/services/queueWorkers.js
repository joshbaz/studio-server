//Intialize the queue and redis connection
import { Queue, Worker } from 'bullmq';
import { redisConnection } from './redisClient.js';
import {  transcodeVideo2, uploadtoDO, uploadHLSToDO, uploadMasterPlaylist, uploadSubtitleToDO, processTrailerToHLS } from "./transcodeVideo.js";
import { io } from "@/utils/sockets.js";
import { upload } from './multer.js';
import prisma from '@/utils/db.mjs';
import fs from 'fs';
import { Agent as HttpsAgent } from 'https';
import dotenv from 'dotenv';
import path from 'path';
dotenv.config();

// Configure HTTPS agent for high concurrency S3 operations
const httpsAgent = new HttpsAgent({
  keepAlive: true,
  keepAliveMsecs: 30000, // 30 seconds
  maxSockets: 500, // Increased from 200 to 500 for very high concurrency
  maxFreeSockets: 100, // Increased from 50 to 100
  timeout: 60000, // 60 seconds
  freeSocketTimeout: 30000, // 30 seconds
  socketAcquisitionWarningTimeout: 10000, // Increased to 10 seconds warning
});

// Shared S3 client configuration for high concurrency
const createS3Client = async () => {
  const { S3Client } = await import('@aws-sdk/client-s3');
  return new S3Client({
    endpoint: process.env.DO_REGIONALSPACESENDPOINT,
    region: process.env.DO_SPACESREGION,
    credentials: {
      accessKeyId: process.env.DO_SPACEACCESSKEY,
      secretAccessKey: process.env.DO_SPACESECRETKEY
    },
    maxAttempts: 3, // Retry failed requests
    retryMode: 'adaptive', // Adaptive retry strategy
    requestHandler: {
      httpOptions: {
        agent: httpsAgent,
        timeout: 60000, // 60 seconds timeout
      }
    }
  });
};

// const connection = new createClient({
//     // url: process.env.REDIS_URL,
//     // url: "redis://localhost:6379",
//     host: "localhost",
//     port: 6379,
//     socket: {
//         reconnectStrategy: () => 1000, // Reconnect after 1 sec if connection is lost
//     }
// });

// connection.connect();

const videoQueue = new Queue("video-transcoding", { connection: { ...redisConnection, maxRetriesPerRequest: null },});
const uploadQueue = new Queue("upload-to-s3", { connection: { ...redisConnection, maxRetriesPerRequest: null },});
const hlsUploadQueue = new Queue("upload-hls-to-s3", { connection: { ...redisConnection, maxRetriesPerRequest: null },});
const masterPlaylistQueue = new Queue("upload-master-playlist", { connection: { ...redisConnection, maxRetriesPerRequest: null },});

const videoWorker = new Worker(
    "video-transcoding",
    async (job)=> {
        console.log(`Processing job: ${job.name} with ID: ${job.id}`);
        
        // Handle different job types
        if (job.name === 'process-trailer-hls') {
            // Handle trailer processing
            const { jobId, type, filePath, resourceId, resource, fileName, filename, bucketName, clientId } = job.data;
            
            // Update job status to active
            try {
                await prisma.videoProcessingJob.updateMany({
                    where: { jobId: jobId },
                    data: { 
                        status: 'active',
                        canCancel: true
                    }
                });
            } catch (dbError) {
                console.log('Could not update trailer job status to active:', dbError.message);
            }
            
            try {
                // Set up processing directories
                const outputDir = path.join(process.cwd(), 'temp', 'trailer_processing', Date.now().toString());
                await fs.promises.mkdir(outputDir, { recursive: true });

                // Process trailer to HLS
                const result = await processTrailerToHLS({
                    filePath,
                    outputDir,
                    filename,
                    bucketName,
                    clientId
                });

                // Create video record with HLS data
                const videoData = {
                    url: result.hlsUrl,
                    hlsUrl: result.hlsUrl,
                    format: 'application/vnd.apple.mpegurl',
                    name: filename,
                    size: result.size,
                    duration: result.duration,
                    encoding: 'libx264',
                    isTrailer: true,
                    resolution: 'HD',
                    bitrate: '2500k',
                };

                if (type === 'film') {
                    videoData.filmId = resourceId;
                } else {
                    videoData.seasonId = resourceId;
                }

                await prisma.video.create({
                    data: videoData,
                });

                // Clean up temporary files
                await fs.promises.rm(filePath);
                await fs.promises.rm(outputDir, { recursive: true, force: true });

                // Update job status to completed
                try {
                    await prisma.videoProcessingJob.updateMany({
                        where: { jobId: jobId },
                        data: { 
                            status: 'completed',
                            progress: 100,
                            canCancel: false
                        }
                    });
                } catch (dbError) {
                    console.log('Could not update trailer job status to completed:', dbError.message);
                }

                io.to(clientId).emit("JobCompleted", {
                    message: "Trailer processing finished",
                    jobId: jobId,
                    hlsUrl: result.hlsUrl,
                    clientId
                });

                console.log(`✅ Trailer processing completed: ${result.hlsUrl}`);

            } catch (error) {
                console.error(`❌ Trailer processing failed for job ${jobId}:`, error);
                throw error; // Will be handled by the failed handler
            }
            
        } else {
            // Handle regular video transcoding (existing logic)
            const { type, filePath, resourceId, resource, fileName, filename, outputDir, clientId, bucketName } = job.data;
        
        // Update job status to active
        try {
            await prisma.videoProcessingJob.updateMany({
                where: { jobId: job.id.toString() },
                data: { 
                    status: 'active',
                    canCancel: true // Active jobs can still be stopped
                }
            });
        } catch (dbError) {
            console.log('Could not update job status to active:', dbError.message);
        }
        
        try {
            await transcodeVideo2({
                type,
                filePath,
                resourceId,
                resource,
                fileName,
                filename,
                outputDir,
                clientId,
                bucketName,
                jobId: job.id.toString(), // Pass the job ID for cancellation checks
            });
            
            // Update job status to completed
            try {
                await prisma.videoProcessingJob.updateMany({
                    where: { jobId: job.id.toString() },
                    data: { 
                        status: 'completed',
                        progress: 100,
                        canCancel: false
                    }
                });
            } catch (dbError) {
                console.log('Could not update job status to completed:', dbError.message);
            }
            
            io.to(clientId).emit("JobCompleted", {
                message: "Processing finished",
                clientId
            });
        } catch (error) {
            // Check if job was cancelled
            const jobRecord = await prisma.videoProcessingJob.findFirst({
                where: { jobId: job.id.toString() }
            });
            
            if (jobRecord && jobRecord.status === 'cancelled') {
                console.log(`Job ${job.id} was cancelled, skipping error handling`);
                return; // Don't mark as failed if it was cancelled
            }
            
            // If not cancelled, throw the error to trigger failed handler
            throw error;
            }
        }
    },
    { connection: { ...redisConnection, maxRetriesPerRequest: null }, concurrency: 1}
);

videoWorker.on("failed", async (job, err)=> {
    console.log(`Job ${job.name} (ID: ${job.id}) failed with error: ${err.message}`);
    
    // Check if job was cancelled (don't mark as failed if cancelled)
    let jobId;
    if (job.name === 'process-trailer-hls') {
        jobId = job.data.jobId;
    } else {
        jobId = job.id.toString();
    }
    
    try {
        const jobRecord = await prisma.videoProcessingJob.findFirst({
            where: { jobId: jobId }
        });
        
        if (jobRecord && jobRecord.status === 'cancelled') {
            console.log(`Job ${jobId} was cancelled, not marking as failed`);
            return;
        }
    } catch (dbError) {
        console.log('Could not check job status:', dbError.message);
    }
    
    // Update job status to failed
    try {
        await prisma.videoProcessingJob.updateMany({
            where: { jobId: jobId },
            data: { 
                status: 'failed',
                errorMessage: err.message,
                canCancel: false
            }
        });
    } catch (dbError) {
        console.log('Could not update job status to failed:', dbError.message);
    }
    
    // Clean up temporary files for trailer jobs
    if (job.name === 'process-trailer-hls') {
        try {
            const { filePath } = job.data;
            if (filePath && fs.existsSync(filePath)) {
                await fs.promises.rm(filePath);
                console.log(`🗑️ Cleaned up failed trailer file: ${filePath}`);
            }
        } catch (cleanupError) {
            console.error('❌ Error cleaning up failed trailer files:', cleanupError);
        }
    }
    
    const clientId = job.data.clientId;
    if (clientId) {
        io.to(clientId).emit("JobFailed", {
            message: `${job.name === 'process-trailer-hls' ? 'Trailer processing' : 'Video processing'} failed: ${err.message}`,
            jobId: jobId,
            error: err.message,
            clientId
        });
    }
});

const uploadWorker = new Worker(
    "upload-to-s3",
    async (job)=> {
        console.log(`Processing job: ${job.id}`);
        const {   mergedFilePath,
            label,
            filename,
            resourceId,
            bucketName,
            clientId,
            type, 
            initialMetadata
        } = job.data;
        
        // Validate required parameters
        if (!mergedFilePath) {
            throw new Error(`Missing mergedFilePath for job ${job.id}. This might be an old job format.`);
        }
        
        if (!fs.existsSync(mergedFilePath)) {
            throw new Error(`File not found: ${mergedFilePath}`);
        }
        
        await uploadtoDO({
            mergedFilePath,
            label,
            filename,
            resourceId,
            bucketName,
            clientId,
            type,
            initialMetadata
        });
        io.to(clientId).emit("UploadCompleted", {message: `${label}_${filename} - Upload finished`});
        
    },
    { connection: { ...redisConnection, maxRetriesPerRequest: null }, concurrency: 2}
);

uploadWorker.on("failed", (job, err)=> {
    let { label, filename } = job.data;
    console.log(`Job ${job.id} failed upload ${label}_${filename} with error ${err.message}`);
    io.to(job.data.clientId).emit("JobFailed", {message: `${label}_${filename}- Uploading  failed`});
});

// HLS Upload Worker
const hlsUploadWorker = new Worker(
    "upload-hls-to-s3",
    async (job)=> {
        console.log(`Processing HLS upload job: ${job.id}`);
        
        // Check if this is a subtitle upload job
        if (job.name === "upload-subtitle-to-s3") {
            const {   
                subtitlePath,
                filename,
                resourceId,
                bucketName,
                clientId,
                type,
                uploadPath,
                subtitleMetadata // Add subtitleMetadata parameter
            } = job.data;
            
            // Create upload job record in database
            try {
                await prisma.uploadJob.create({
                    data: {
                        jobId: job.id.toString(),
                        queueName: 'upload-hls-to-s3',
                        jobType: 'upload-subtitle-to-s3',
                        status: 'active',
                        progress: 0,
                        resourceType: type,
                        resourceId,
                        filename,
                        uploadType: 'subtitle',
                        contentType: 'subtitle',
                        subtitlePath,
                        uploadPath,
                        subtitleMetadata,
                        bucketName,
                        clientId,
                        canCancel: true,
                    }
                });
                console.log(`📝 Created subtitle upload job record: ${job.id}`);
            } catch (dbError) {
                console.warn(`⚠️ Could not create subtitle upload job record:`, dbError.message);
            }
            
            await uploadSubtitleToDO({
                subtitlePath,
                filename,
                resourceId,
                bucketName,
                clientId,
                type,
                uploadPath,
                subtitleMetadata // Pass subtitleMetadata for database creation
            });
            
            // Update job status to completed
            try {
                await prisma.uploadJob.updateMany({
                    where: { jobId: job.id.toString() },
                    data: { 
                        status: 'completed',
                        progress: 100,
                        canCancel: false
                    }
                });
            } catch (dbError) {
                console.warn(`⚠️ Could not update subtitle upload job status:`, dbError.message);
            }
            
            io.to(clientId).emit("UploadCompleted", {message: `Subtitle ${filename} - Upload finished`});
        } else {
            // Handle regular HLS upload jobs (without subtitle paths since they're uploaded separately)
            const {   
                hlsDir,
                label,
                filename,
                resourceId,
                bucketName,
                clientId,
                type, 
                initialMetadata
            } = job.data;
            
            // Create upload job record in database
            try {
                await prisma.uploadJob.create({
                    data: {
                        jobId: job.id.toString(),
                        queueName: 'upload-hls-to-s3',
                        jobType: 'upload-hls-to-s3',
                        status: 'active',
                        progress: 0,
                        resourceType: type,
                        resourceId,
                        filename,
                        uploadType: 'hls',
                        contentType: 'video',
                        label,
                        hlsDir,
                        initialMetadata,
                        bucketName,
                        clientId,
                        canCancel: true,
                    }
                });
                console.log(`📝 Created HLS upload job record: ${job.id}`);
            } catch (dbError) {
                console.warn(`⚠️ Could not create HLS upload job record:`, dbError.message);
            }
            
            await uploadHLSToDO({
                hlsDir,
                label,
                filename,
                resourceId,
                bucketName,
                clientId,
                type,
                initialMetadata,
                subtitlePaths: [] // No resolution-specific subtitles in new approach
            });
            
            // Update job status to completed
            try {
                await prisma.uploadJob.updateMany({
                    where: { jobId: job.id.toString() },
                    data: { 
                        status: 'completed',
                        progress: 100,
                        canCancel: false
                    }
                });
            } catch (dbError) {
                console.warn(`⚠️ Could not update HLS upload job status:`, dbError.message);
            }
            
            io.to(clientId).emit("UploadCompleted", {message: `HLS ${label}_${filename} - Upload finished`});
        }
    },
    { connection: { ...redisConnection, maxRetriesPerRequest: null }, concurrency: 2}
);

hlsUploadWorker.on("failed", async (job, err)=> {
    if (job.name === "upload-subtitle-to-s3") {
        let { filename } = job.data;
        console.log(`Subtitle upload job ${job.id} failed ${filename} with error ${err.message}`);
        
        // Update job status to failed in database
        try {
            await prisma.uploadJob.updateMany({
                where: { jobId: job.id.toString() },
                data: { 
                    status: 'failed',
                    failedReason: err.message,
                    canCancel: false
                }
            });
        } catch (dbError) {
            console.warn(`⚠️ Could not update failed subtitle upload job status:`, dbError.message);
        }
        
        io.to(job.data.clientId).emit("JobFailed", {message: `Subtitle ${filename}- Uploading failed`});
    } else {
        let { label, filename } = job.data;
        console.log(`HLS upload job ${job.id} failed ${label}_${filename} with error ${err.message}`);
        
        // Update job status to failed in database
        try {
            await prisma.uploadJob.updateMany({
                where: { jobId: job.id.toString() },
                data: { 
                    status: 'failed',
                    failedReason: err.message,
                    canCancel: false
                }
            });
        } catch (dbError) {
            console.warn(`⚠️ Could not update failed HLS upload job status:`, dbError.message);
        }
        
        io.to(job.data.clientId).emit("JobFailed", {message: `HLS ${label}_${filename}- Uploading failed`});
    }
});

// Master Playlist Upload Worker
const masterPlaylistWorker = new Worker(
    "upload-master-playlist",
    async (job)=> {
        console.log(`Processing master playlist upload job: ${job.id}`);
        const {   
            masterPlaylistPath,
            filename,
            resourceId,
            bucketName,
            clientId,
            type,
            subtitleLanguages
        } = job.data;
        
        // Create upload job record in database
        try {
            await prisma.uploadJob.create({
                data: {
                    jobId: job.id.toString(),
                    queueName: 'upload-master-playlist',
                    jobType: 'upload-master-playlist',
                    status: 'active',
                    progress: 0,
                    resourceType: type,
                    resourceId,
                    filename,
                    uploadType: 'master_playlist',
                    contentType: 'playlist',
                    masterPlaylistPath,
                    subtitleLanguages,
                    bucketName,
                    clientId,
                    canCancel: true,
                }
            });
            console.log(`📝 Created master playlist upload job record: ${job.id}`);
        } catch (dbError) {
            console.warn(`⚠️ Could not create master playlist upload job record:`, dbError.message);
        }
        
        await uploadMasterPlaylist({
            masterPlaylistPath,
            filename,
            resourceId,
            bucketName,
            clientId,
            type,
            subtitleLanguages
        });
        
        // Update job status to completed
        try {
            await prisma.uploadJob.updateMany({
                where: { jobId: job.id.toString() },
                data: { 
                    status: 'completed',
                    progress: 100,
                    canCancel: false
                }
            });
        } catch (dbError) {
            console.warn(`⚠️ Could not update master playlist upload job status:`, dbError.message);
        }
        
        io.to(clientId).emit("UploadCompleted", {message: `Master playlist ${filename} - Upload finished`});
    },
    { connection: { ...redisConnection, maxRetriesPerRequest: null }, concurrency: 2}
);

masterPlaylistWorker.on("failed", async (job, err)=> {
    let { filename } = job.data;
    console.log(`Master playlist upload job ${job.id} failed ${filename} with error ${err.message}`);
    
    // Update job status to failed in database
    try {
        await prisma.uploadJob.updateMany({
            where: { jobId: job.id.toString() },
            data: { 
                status: 'failed',
                failedReason: err.message,
                canCancel: false
            }
        });
    } catch (dbError) {
        console.warn(`⚠️ Could not update failed master playlist upload job status:`, dbError.message);
    }
    
    io.to(job.data.clientId).emit("JobFailed", {message: `Master playlist ${filename}- Uploading failed`});
});

export { videoQueue, videoWorker, uploadQueue, uploadWorker, hlsUploadQueue, hlsUploadWorker, masterPlaylistQueue, masterPlaylistWorker };