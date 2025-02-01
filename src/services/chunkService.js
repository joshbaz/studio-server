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

    formatFileName(fileName) {
        return fileName.split('.').shift().replace(/\s/g, '_');
    }

    checkChunk(fileName, start) {
        // strip the file extension from the filename and replace the spaces with underscores
        const filename = this.formatFileName(fileName);
        const fileDir = path.join(this.uploadDir, filename);
        const chunkPath = path.join(fileDir, `${fileName}-${start}`);
        return fs.existsSync(chunkPath);
    }

    async saveChunk(tempPath, fileName, start) {
        // create a directory if it doesn't exist and a folder for the file using the filename
        const filename = this.formatFileName(fileName);
        const fileDir = path.join(this.uploadDir, filename);

        if (!fs.existsSync(fileDir)) {
            fs.mkdirSync(fileDir);
        }

        const chunkPath = path.join(fileDir, `${filename}-${start}`);
        return await fs.promises.rename(tempPath, chunkPath);
    }

    combineChunks(fileName) {
        const filename = this.formatFileName(fileName);
        const filePath = path.join(this.uploadDir, filename);
        const chunkFiles = fs
            .readdirSync(filePath)
            .filter((file) => file.startsWith(filename) && !file !== filename)
            .sort((a, b) => {
                const startA = parseInt(a.split('-').pop());
                const startB = parseInt(b.split('-').pop());
                return startA - startB;
            });

        const assembledPath = path.join(this.uploadDir, fileName);

        const writeStream = fs.createWriteStream(assembledPath);
        for (const chunkFile of chunkFiles) {
            const chunkPath = path.join(filePath, chunkFile);
            const data = fs.readFileSync(chunkPath);
            writeStream.write(data);
            fs.unlinkSync(chunkPath); // Delete the chunk after combining
        }
        writeStream.end();
        // delete the directory after combining the chunks
        fs.rmdirSync(filePath);
        return assembledPath;
    }
}

export default ChunkService;
