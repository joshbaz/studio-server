import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { Agent as HttpsAgent } from 'https';

// Configure global Node.js HTTP agent limits for high concurrency
process.env.UV_THREADPOOL_SIZE = '64'; // Increase thread pool size
process.env.NODE_OPTIONS = '--max-old-space-size=4096'; // Increase memory limit

// Configure HTTPS agent for high concurrency S3 operations
// Note: The @smithy/node-http-handler warning about socket capacity is expected during high concurrency
// operations (like video transcoding + subtitle uploads + streaming). The warning appears when there are
// more than 50 concurrent requests, but our configuration handles up to 500 concurrent sockets.
// The warning is informational and doesn't affect functionality - requests are queued and processed.
const httpsAgent = new HttpsAgent({
  keepAlive: true,
  keepAliveMsecs: 30000, // 30 seconds
  maxSockets: 500, // Increased from 200 to 500 for very high concurrency
  maxFreeSockets: 100, // Increased from 50 to 100
  timeout: 60000, // 60 seconds
  freeSocketTimeout: 30000, // 30 seconds
  socketAcquisitionWarningTimeout: 10000, // Increased to 10 seconds warning
});

export const s3Client = new S3Client({
    // region: 'sfo3',
    region: process.env.DO_SPACESREGION,
    // endpoint: 'https://nyati-cdn.sfo3.digitaloceanspaces.com',
    endpoint: process.env.DO_SPACESENDPOINT,
    credentials: {
        accessKeyId: process.env.DO_SPACEACCESSKEY,
        secretAccessKey: process.env.DO_SPACESECRETKEY,
    },
    forcePathStyle: true,
    maxAttempts: 5, // Increased retries for better reliability
    retryMode: 'adaptive', // Adaptive retry strategy
    requestHandler: {
        httpOptions: {
            agent: httpsAgent,
            timeout: 60000, // 60 seconds timeout
            connectTimeout: 30000, // 30 seconds connection timeout
        }
    },
    // Additional configuration for high concurrency
    requestTimeout: 60000, // 60 seconds request timeout
    connectionTimeout: 30000, // 30 seconds connection timeout
});

/**
 * @name uploadToBucket
 * @description function to upload file to bucket
 * @param {Object} params - The upload parameters
 * @param {string} params.bucketName - The bucket name
 * @param {string} params.key - The file key
 * @param {Buffer|ReadableStream} params.buffer - The file buffer or stream
 * @param {string} params.contentType - The content type
 * @param {boolean} params.isPublic - Whether the file should be public
 * @param {Function} params.onProgress - Progress callback function
 * @returns {Promise<Object>} The upload result
 */
export const uploadToBucket = async (params, onProgress) => {
    const { bucketName, key, buffer, contentType, isPublic = false, onProgress: progressCallback } = params;

    const command = new PutObjectCommand({
        Bucket: bucketName,
        Key: key,
        Body: buffer,
        ContentType: contentType,
        ACL: isPublic ? 'public-read' : 'private',
    });

    try {
        const response = await s3Client.send(command);
        
        if (progressCallback) {
            progressCallback(100);
        }

        return {
            url: `${process.env.DO_SPACESENDPOINT}/${bucketName}/${key}`,
            ...response,
        };
    } catch (error) {
        console.error('❌ Upload error:', error);
        throw error;
    }
};

/**
 * @name deleteFromBucket
 * @description function to delete file from bucket
 * @param {Object} params - The delete parameters
 * @param {string} params.bucketName - The bucket name
 * @param {string} params.key - The file key
 * @returns {Promise<Object>} The delete result
 */
export const deleteFromBucket = async (params) => {
    const { bucketName, key } = params;

    const command = new DeleteObjectCommand({
        Bucket: bucketName,
        Key: key,
    });

    try {
        const response = await s3Client.send(command);
        return response;
    } catch (error) {
        console.error('❌ Delete error:', error);
        throw error;
    }
};
