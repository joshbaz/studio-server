import { env } from '@/env.mjs';
import { S3Client } from '@aws-sdk/client-s3';

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
 * @name uploadToBucket
 * @description Upload file to Digital Ocean Spaces
 * @param {string} bucketName
 * @param {string} key
 * @param {Buffer} buffer
 * @returns {Promise<string>}
 */
export const uploadToBucket = async (bucketName, key, buffer) => {
   try {
      const uploadParams = {
         Key: key,
         Bucket: bucketName,
         Body: buffer,
         ContentType: 'image/jpeg',
      };

      const { Location } = await s3Client.upload(uploadParams);
      return Location;
   } catch (error) {
      throw new Error(error.message);
   }
};
