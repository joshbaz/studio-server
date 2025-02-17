import { createClient } from 'redis';

const redisConnection = new createClient({
    // url: process.env.REDIS_URL,
    // url: "redis://localhost:6379",
    host: 'localhost',
    port: 6379,
    socket: {
        reconnectStrategy: () => 1000, // Reconnect after 1 sec if connection is lost
    },
});

redisConnection.on('ready', () => console.log('Connected to Redis ✅'));

// Fix: Set maxRetriesPerRequest to null
redisConnection.on('error', (err) => console.error('Redis Client Error', err));

redisConnection.connect();

export { redisConnection };
