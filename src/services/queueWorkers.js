//Intialize the queue and redis connection
import { Queue, Worker } from 'bullmq';
import { redisConnection } from './redisClient.js';
import { transcodeVideo, transcodeVideo2, uploadtoDO } from "./transcodeVideo.js";
import { io } from "@/utils/sockets.js";
import { upload } from './multer.js';
import prisma from '@/utils/db.mjs';

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

const videoWorker = new Worker(
    "video-transcoding",
    async (job)=> {
        console.log(`Processing job: ${job.id}`);
        const { type, filePath, fileName,filename, outputDir, clientId, bucketName,resourceId, resource, onPreTranscode, onUploadComplete } = job.data;
        
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
    },
    { connection: { ...redisConnection, maxRetriesPerRequest: null }, concurrency: 2}
);

videoWorker.on("failed", async (job, err)=> {
    console.log(`Job ${job.id} failed with error ${err.message}`);
    
    // Check if job was cancelled (don't mark as failed if cancelled)
    try {
        const jobRecord = await prisma.videoProcessingJob.findFirst({
            where: { jobId: job.id.toString() }
        });
        
        if (jobRecord && jobRecord.status === 'cancelled') {
            console.log(`Job ${job.id} was cancelled, not marking as failed`);
            return;
        }
    } catch (dbError) {
        console.log('Could not check job status:', dbError.message);
    }
    
    // Update job status to failed
    try {
        await prisma.videoProcessingJob.updateMany({
            where: { jobId: job.id.toString() },
            data: { 
                status: 'failed',
                failedReason: err.message,
                canCancel: false
            }
        });
    } catch (dbError) {
        console.log('Could not update job status to failed:', dbError.message);
    }
    
    io.to(job.data.clientId).emit("JobFailed", {
        message: "Processing failed",
        clientId: job.data.clientId
    });
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


export { videoQueue, videoWorker, uploadQueue, uploadWorker };