import { io } from './sockets.js';

/**
 * @name broadcastProgress
 * @description function to broadcast upload progress to all clients
 * @param {Object} params - Parameters object
 * @param {number} params.progress - Progress percentage (0-100)
 * @param {string} params.clientId - Client ID to broadcast to
 * @param {Object} params.content - Content object with type and other data
 * @returns {void}
 */
export function broadcastProgress({ progress, clientId, content }) {
    console.log(`Progress: ${progress}%`);
    io.to(clientId).emit('uploadProgress', { content, progress });
} 