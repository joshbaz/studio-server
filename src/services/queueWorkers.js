//Intialize the queue and redis connection
import { Queue, Worker } from 'bullmq';
import { redisConnection } from './redisClient.js';
import { transcodeVideo, transcodeVideo2 } from "./transcodeVideo.js";
import { io } from "@/utils/sockets.js";

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

const videoWorker = new Worker(
    "video-transcoding",
    async (job)=> {
        console.log(`Processing job: ${job.id}`);
        const { type, filePath, fileName,filename, outputDir, clientId, bucketName,resourceId, resource, onPreTranscode, onUploadComplete } = job.data;
        
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
                socio: io,
            });
            io.to(clientId).emit("JobCompleted", {message: "Processing finished"});
        
    },
    { connection: { ...redisConnection, maxRetriesPerRequest: null }, concurrency: 2}
);

videoWorker.on("failed", (job, err)=> {
    console.log(`Job ${job.id} failed with error ${err.message}`);
    io.to(job.data.clientId).emit("JobFailed", {message: "Processing failed"});
});

export { videoQueue, videoWorker };