import { env } from '@/env.mjs';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';

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
}) => {
   try {
      const uploadParams = {
         Key: key,
         Bucket: bucketName,
         Body: buffer,
         ContentType: contentType,
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

      // console.log('uploadParams', uploadParams);

      // const command = new PutObjectCommand(uploadParams);
      // const response = await s3Client.send(command);

      return {
         url: `${env.DO_SPACESENDPOINT}/${key}`,
         ...response,
      };
   } catch (error) {
      throw new Error(error.message);
   }
};
