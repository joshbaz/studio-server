import { env } from '../env.mjs';
import { Upload } from '@aws-sdk/lib-storage';
import { S3Client, DeleteObjectCommand, CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand } from '@aws-sdk/client-s3';
import fs from 'fs';

export const s3Client = new S3Client({
    region: 'fra1',
    endpoint: env.DO_SPACESENDPOINT,
    credentials: {
        accessKeyId: env.DO_SPACEACCESSKEY,
        secretAccessKey: env.DO_SPACESECRETKEY,
    },
    forcePathStyle: true,
});

/**
 * @typedef {Object} UploadToBucketParams
 * @property {string} bucketName
 * @property {string} key
 * @property {Buffer} buffer
 * @property {string} contentType
 * @property {boolean} isPublic
 */

/**
 * @name uploadToBucket
 * @description Upload file to Digital Ocean Spaces
 * @param {UploadToBucketParams} params
 * @param {VoidFunction} [onUploadProgress] - Callback function to track upload progress
 * @returns {Promise<string>}
 */
export const uploadToBucket = async (
    { key, buffer, isPublic, bucketName, contentType },
    onUploadProgress
) => {
    try {
        const uploadParams = {
            Key: key,
            Body: buffer,
            Bucket: bucketName,
            ContentType: contentType,
            ACL: isPublic ? 'public-read' : 'private',
        };

        const upload = new Upload({
            client: s3Client,
            params: uploadParams,
        });

        // remove this as its only for backend testing ...
        upload.on('httpUploadProgress', (progress) => {
            const customProgress = Math.floor(
                (progress.loaded / progress.total) * 100
            );

            // Broadcast progress to all connected clients
            if (onUploadProgress) onUploadProgress(customProgress);
        });

        const { $metadata: Omit, ETag, ...response } = await upload.done();

        return {
            url: `${env.DO_SPACESENDPOINT}/${bucketName}/${key}`,
            ...response,
        };
    } catch (error) {
        throw new Error(error.message);
    }
};

/**
 * Joshua's test upload
 */
// export const uploadToBucketTest = async (
//     { key, bufferPath, isPublic, bucketName, contentType },
//     onUploadProgress
// ) => {
//     try {
//         const fileStream = fs.createReadStream(bufferPath);
//         const fileSize = fs.statSync(bufferPath).size;
//         const chunkSize = 50 * 1024 * 1024; // 5MB
//         const totalParts = Math.ceil(fileSize / chunkSize);

//         console.log(`Starting upload: ${key} (${fileSize} bytes, ${totalParts} parts)`);

//         const createUpload = new CreateMultipartUploadCommand(
//             {
//                 Bucket: bucketName,
//                 Key: key,
//                 ContentType: contentType,
//                 ACL: isPublic ? 'public-read' : 'private',
//             });
        
//         const { UploadId } = await s3Client.send(createUpload);
//         let partNumber = 1;
//         let parts = [];
//         let uploadedSize = 0;

//         for await (const chunk of fileStream) {
//             const uploadPart = new UploadPartCommand({
//                 Bucket: bucketName,
//                 Key: key,
//                 UploadId,
//                 PartNumber: partNumber,
//                 Body: chunk,
//             });
            
//             const { ETag } = await s3Client.send(uploadPart);
//             parts.push({ ETag, PartNumber: partNumber });

//              // Update progress
//              uploadedSize += chunk.length;
//              const progress = Math.floor((uploadedSize / fileSize) * 100);
//              if (onUploadProgress) onUploadProgress(progress);

//             partNumber++;
//         }

//         const completeUpload = new CompleteMultipartUploadCommand({
//             Bucket: bucketName,
//             Key: key,
//             UploadId,
//             MultipartUpload: {
//                 Parts: parts,
//             },
//         });

//         await s3Client.send(completeUpload);

//         return {
//             url: `${env.DO_SPACESENDPOINT}/${bucketName}/${key}`,
//             size: fileSize,
//         };
//     }
//     catch (error) {
//         throw new Error(error.message);
//     }
// };

/**
 * @name streamFromBucket
 * @description Stream file from Digital Ocean Spaces
 * @param {Pick<"bucketName"|"key", UploadToBucketParams>} params
 * @returns {Promise<string>}
 */
export const streamFromBucket = async ({ bucketName, key }) => {
    try {
        // TODO: Implement streaming from Digital Ocean Spaces
    } catch (error) {
        throw new Error(error.message);
    }
};

/**
 * @name deleteFromBucket
 * @description Delete file from Digital Ocean Spaces
 * @param {Pick<"bucketName"|"key", UploadToBucketParams>} params
 * @returns {Promise<string>}
 */
export const deleteFromBucket = async ({ bucketName, key }) => {
    try {
        const deleteParams = {
            Bucket: bucketName,
            Key: key,
        };

        const command = new DeleteObjectCommand(deleteParams);
        const response = await s3Client.send(command);
        return response;
    } catch (error) {
        throw new Error(error.message);
    }
};
