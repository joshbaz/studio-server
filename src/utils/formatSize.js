/**
 * @name formatFileSize
 * @description function to format file size from bytes to human readable format
 * @param {number} size - Size in bytes
 * @returns {string} - Formatted size string (e.g., "1.5 MB")
 */
export function formatFileSize(size) {
    if (size < 1024) {
        return `${size} B`;
    } else if (size < 1024 ** 2) {
        return `${(size / 1024).toFixed(2)} KB`;
    } else if (size < 1024 ** 3) {
        return `${(size / 1024 ** 2).toFixed(2)} MB`;
    } else {
        return `${(size / 1024 ** 3).toFixed(2)} GB`;
    }
} 