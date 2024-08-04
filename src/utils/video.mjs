import { env } from '@/env.mjs';
import { Upload } from '@aws-sdk/lib-storage';
import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';

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
 * @returns {Promise<string>}
 */
export const uploadToBucket = async ({
   bucketName,
   key,
   buffer,
   contentType,
   isPublic,
}) => {
   try {
      const uploadParams = {
         Key: key,
         Bucket: bucketName,
         Body: buffer,
         ContentType: contentType,
         ACL: isPublic ? 'public-read' : 'private',
      };

      const upload = new Upload({
         client: s3Client,
         params: uploadParams,
      });

      upload.on('httpUploadProgress', (progress) => {
         const customProgress = Math.floor(
            (progress.loaded / progress.total) * 100
         );
         console.log(`Progress: ${customProgress}%`);
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
      console.log(bucketName, key);
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
