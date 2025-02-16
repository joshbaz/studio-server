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
        socket.on("joinRoom", (roomName) => {
            console.log(`Client ${socket.id} joined room ${roomName}`);
            socket.join(roomName);
        });
        socket.on("leaveRoom", (roomName) => {
            console.log(`Client ${socket.id} left room ${roomName}`);
            socket.leave(roomName);
        });
        socket.on('disconnect', () => {
            console.log('Client disconnected ✅', socket.id);
        });
    });
};

export { io, initIO };
