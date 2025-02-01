import { Server } from 'socket.io';
import { CORS_OPTIONS } from './corsOptions.js';

/**
 * @type {Server | null}
 */
let io = null;

const initIO = (server) => {
    io = new Server(server, { cors: CORS_OPTIONS });

    io.on('connection', (socket) => {
        console.log('Client connected ✅', socket.id);

        socket.on('disconnect', () => {
            console.log('Client disconnected ✅', socket.id);
        });
    });
};

export { io, initIO };
