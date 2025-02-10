import path from 'path';
import fs from 'fs';

const UPLOAD_DIR = path.resolve(process.cwd(), 'uploads');

/**
 * Service to handle file chunking
 * @class ChunkService
 * @param {string} uploadDir - The directory to save the uploaded files to
 * @returns {void}
 *
 * @example
 * const chunkService = new ChunkService();
 * chunkService.saveChunk('file.mp4', 0);
 */

class ChunkService {
    constructor(uploadDir = UPLOAD_DIR) {
        this.uploadDir = uploadDir;
        if (!fs.existsSync(this.uploadDir)) {
            fs.mkdirSync(this.uploadDir);
        }
    }

    /**
     * @name formatFileName
     * @description Format the file name by removing spaces and replacing them with underscores and returning the name and extension as an object.
     * @param {string} fileName
     * @returns {{ ext: string; filename: string }}
     * @example
     * const chunkService = new ChunkService();
     * const result = chunkService.formatFileName('file mp4'); // returns {ext: 'mp4', filename: 'file_mp4'}
     */
    formatFileName(fileName) {
        const splitName = fileName.toLowerCase().replace(/\s/g, '_').split('.');
        const ext = splitName[splitName.length - 1];
        const filename = splitName.filter((item) => item !== ext).join('_');
        return { ext, filename };
    }

    checkChunk(fileName, start) {
        // strip the file extension from the filename and replace the spaces with underscores
        const { filename } = this.formatFileName(fileName);
        const fileDir = path.join(this.uploadDir, filename);
        const chunkPath = path.join(fileDir, `${fileName}-${start}`);
        return fs.existsSync(chunkPath);
    }

    async saveChunk(tempPath, fileName, start) {
        // create a directory if it doesn't exist and a folder for the file using the filename
        const { filename } = this.formatFileNaxme(fileName);
        const fileDir = path.join(this.uploadDir, filename);

        if (!fs.existsSync(fileDir)) {
            fs.mkdirSync(fileDir);
        }

        const chunkPath = path.join(fileDir, `${filename}-${start}`);

        try {
            await fs.promises.access(tempPath, fs.constants.F_OK);
            await fs.promises.rename(tempPath, chunkPath);
            console.log(`Saved chunk ${chunkPath}`);
        } catch (err) {
            console.error(`Error moving chunk`);
            throw err;
        }
    }

    async combineChunks(fileName) {
        const { filename, ext } = this.formatFileName(fileName);
        const filePath = path.join(this.uploadDir, filename);
        const chunkFiles = fs
            .readdirSync(filePath)
            .filter((file) => file.startsWith(filename) && file !== filename)
            .sort((a, b) => {
                const startA = parseInt(a.split('-').pop());
                const startB = parseInt(b.split('-').pop());
                return startA - startB;
            });

        const assembledPath = path.join(this.uploadDir, `${filename}.${ext}`);
        const writeStream = fs.createWriteStream(assembledPath, { flags: 'a' });

        try {
            for (const chunkFile of chunkFiles) {
                const chunkPath = path.join(filePath, chunkFile);

                const readStream = fs.createReadStream(chunkPath);

                await new Promise((resolve, reject) => {
                    readStream.pipe(writeStream, { end: false });
                    readStream.on('end', resolve);
                    readStream.on('error', reject);
                });
            }

            writeStream.on('finish', async () => {
                console.log('All chunks combined successfully');
                await this.deleteChunksFolder(fileName);
            });

            writeStream.on('error', async (err) => {
                console.log('Error writing combined file', err);
                await fs.promises.rm(filePath, {
                    recursive: true,
                    force: true,
                });
            });

            writeStream.end(); // End the write stream after processing all chunks
            return assembledPath;
        } catch (error) {
            writeStream.destroy(error);
            throw error;
        }
    }

    async deleteChunksFolder(fileName) {
        const { filename } = this.formatFileName(fileName);
        const filePath = path.join(this.uploadDir, filename);
        return await fs.promises.rm(filePath, { recursive: true }); // Delete the directory and its contents
    }
}

export default ChunkService;
