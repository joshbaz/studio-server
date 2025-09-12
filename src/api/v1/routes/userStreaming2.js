import express from 'express';
import fs from 'fs';
import path from 'path';
import { S3Client, GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { PrismaClient } from '@prisma/client';
import { Agent as HttpsAgent } from 'https';
import { Agent as HttpAgent } from 'http';
import dotenv from 'dotenv'
import jwt from 'jsonwebtoken';
import { verifyToken } from '../middleware/verifyToken.js';
import {pipeline} from 'stream/promises';
import rateLimit from "express-rate-limit";
import { s3UserRequestQueue, s3UserSubtitleQueue } from '@/services/request-queue.js';

dotenv.config();

// Connection state monitoring
const connectionStates = new Map();
const router = express.Router();
const prisma = new PrismaClient();

// Add request tracking at the top of your userStreaming server
const activeStreamRequests = new Map();

// Add proper error handling for aborted requests
const handleStreamError = (error, res) => {
    if (error.code === 'ECONNRESET' || error.message === 'aborted' ||
      error.code === 'ERR_STREAM_PREMATURE_CLOSE' || error.name === 'AbortError') {
      console.log('⚠️ Client aborted stream request (normal behavior for seeking)');
      // Don't send error response if connection was aborted by client
      if (!res.headersSent) {
        res.destroy();
      }
      return true;
    }
  
    console.error('❌ Streaming error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Streaming failed' });
    }
    return false;
  };
  
  // Enhanced stream handling with better seeking support
  const streamWithErrorHandling = async (readableStream, res, req, rangeInfo) => {
    return new Promise((resolve) => {
      let clientDisconnected = false;
      let streamDestroyed = false;
  
      // Handle client disconnection
      const cleanup = () => {
        if (!streamDestroyed) {
          streamDestroyed = true;
          if (readableStream && typeof readableStream.destroy === 'function') {
            readableStream.destroy();
          }
        }
        resolve();
      };
  
      req.on('close', () => {
        clientDisconnected = true;
        console.log('⚠️ Client disconnected during streaming (normal for seeking)');
        cleanup();
      });
  
      req.on('aborted', () => {
        clientDisconnected = true;
        console.log('⚠️ Request aborted by client');
        cleanup();
      });
  
      // Handle stream errors
      readableStream.on('error', (error) => {
        if (clientDisconnected) {
          // Client already disconnected, ignore error
          cleanup();
          return;
        }
  
        if (error.code === 'ECONNRESET' || error.code === 'ERR_STREAM_PREMATURE_CLOSE') {
          console.log('⚠️ Stream closed prematurely (client seeking)');
          cleanup();
        } else {
          console.error('❌ Stream error:', error);
          if (!res.headersSent) {
            res.status(500).end('Stream error');
          }
          cleanup();
        }
      });
  
      // Handle response errors
      res.on('error', (error) => {
        if (clientDisconnected) {
          cleanup();
          return;
        }
        console.error('❌ Response error:', error);
        cleanup();
      });
  
      // Pipe the stream
      readableStream.pipe(res)
        .on('finish', () => {
          if (!clientDisconnected) {
            console.log('✅ Stream completed successfully');
          }
          cleanup();
        })
        .on('error', (error) => {
          if (clientDisconnected) {
            cleanup();
            return;
          }
          console.error('❌ Pipe error:', error);
          cleanup();
        });
  
      // Add timeout for slow streams
      const timeout = setTimeout(() => {
        if (!clientDisconnected) {
          console.log('⏰ Stream timeout, cleaning up');
          cleanup();
        }
      }, 30000); // 30 second timeout
  
      // Cleanup timeout on completion
      res.on('close', () => {
        clearTimeout(timeout);
      });
    });
  };

// Configure HTTPS agent for ultra-high concurrency S3 operations (2000+ concurrent users)
const httpsAgent = new HttpsAgent({
  keepAlive: true, // ✅ Enable connection pooling for massive scale
  keepAliveMsecs: 60000, // 60 seconds - longer keep-alive for high concurrency
  maxSockets: 2000, // Scale for 2000+ concurrent connections
  maxFreeSockets: 500, // Large pool of reusable connections
  timeout: 30000, // 2 minutes - longer timeout for high load
  scheduling: 'lifo', //Last-In-First-Out for better performance
});

// Set global agents for all HTTP/HTTPS requests
global.httpsAgent = httpsAgent;


// Initialize ultra-high concurrency S3 client for 2000+ concurrent users
const s3Client = new S3Client({
  endpoint: process.env.DO_REGIONALSPACESENDPOINT,
  region: process.env.DO_SPACESREGION,
  credentials: {
    accessKeyId: process.env.DO_SPACEACCESSKEY,
    secretAccessKey: process.env.DO_SPACESECRETKEY
  },
  maxAttempts: 5, // Increased retries for high concurrency
  retryMode: 'adaptive', // Adaptive retry strategy
  requestHandler: {
    httpOptions: {
      agent: httpsAgent,
      timeout: 15000, // 2 minutes timeout for high load
      connectTimeout: 8000, // 1 minute connection timeout
      socketTimeout: 15000
    }
  },
   // TCP optimization
   tcpKeepAlive: true,
   connectionTimeout: 8000,
   // Disable the warning or increase timeout
   socketAcquisitionWarningTimeout: 30000, // 30 seconds instead of default
});

/**
 * Verify token from query parameter or Authorization header
 */
const verifyStreamingToken = (req) => {
      console.log(`🔍 User streaming: Full URL being processed:`, req.url);
    console.log(`🔍 User streaming: Query parameters:`, req.query);
    console.log(`🔍 User streaming: Headers:`, req.headers);
    console.log(`🔍 User streaming: Method:`, req.method);
  
  // First try to get token from query parameter
  let queryToken = req.query.token;
  
  // Handle case where multiple tokens exist (req.query.token becomes an array)
  if (Array.isArray(queryToken)) {
    // Take the first token if multiple exist
    queryToken = queryToken[0];
    console.log(`⚠️ User streaming: Multiple tokens detected, using first one`);
    console.log(`🔍 User streaming: All tokens received:`, req.query.token);
  }
  
  if (queryToken && typeof queryToken === 'string') {
    try {
      const decoded = jwt.verify(queryToken, process.env.SECRETVA);
      console.log(`🔐 User streaming: Token verified from query parameter for user: ${decoded.userId}`);
      return { userId: decoded.userId, isValid: true };
    } catch (error) {
      console.log(`❌ User streaming: Invalid token from query parameter:`, error.message);
      return { userId: null, isValid: false };
    }
  }
  
  // Fallback to Authorization header (for backward compatibility)
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      const token = authHeader.substring(7);
      const decoded = jwt.verify(token, process.env.SECRETVA);
      console.log(`🔐 User streaming: Token verified from Authorization header for user: ${decoded.userId}`);
      return { userId: decoded.userId, isValid: true };
    } catch (error) {
      console.log(`❌ User streaming: Invalid token from Authorization header:`, error.message);
      return { userId: null, isValid: false };
    }
  }
  
  console.log(`❌ User streaming: No valid token found in query parameter or Authorization header`);
  return { userId: null, isValid: false };
};

// Ultra-high concurrency user streaming configuration for 2000+ concurrent users
const USER_STREAMING_CONFIG = {
  // Adaptive chunk sizes based on content type and load
  CHUNK_SIZES: {
    m3u8: 32 * 1024,     // 32KB for playlists (ultra-fast loading)
    ts: 512 * 1024,      // 512KB for video segments (memory efficient)
    mp4: 256 * 1024,     // 256KB for MP4 files (balanced)
    default: 128 * 1024  // 128KB default (conservative)
  },
  
  // Aggressive cache durations for high concurrency
  CACHE_DURATIONS: {
    m3u8: 600,    // 10 minutes for playlists (reduce server load)
    ts: 604800,   // 7 days for segments (maximize caching)
    mp4: 2592000, // 30 days for MP4 files (long-term caching)
    default: 7200 // 2 hours default
  },
  
  // Optimized range request limits for high concurrency
  MAX_RANGE_SIZE: 5 * 1024 * 1024,  // 5MB max range size (memory efficient)
  MIN_RANGE_SIZE: 512,               // 512B min range size (granular control)
  
  // Memory-efficient buffer settings
  BUFFER_SIZE: 32 * 1024,           // 32KB buffer (reduced for high concurrency)
  HIGH_WATER_MARK: 64 * 1024,       // 64KB high water mark (prevent memory buildup)
  
  // High concurrency specific settings
  MAX_CONCURRENT_STREAMS: 2500,      // Support 2500 concurrent streams
  STREAM_TIMEOUT: 300000,            // 5 minutes stream timeout
  BACKPRESSURE_THRESHOLD: 0.8,       // 80% memory usage threshold
  MEMORY_POOL_SIZE: 100 * 1024 * 1024, // 100MB memory pool
  CONNECTION_POOL_TIMEOUT: 30000,    // 30 seconds connection pool timeout
};


// Simple connection tracker
const connectionTracker = {
  active: 0,
  max: 1000,
  acquire() {
    if (this.active < this.max) {
      this.active++;
      return true;
    }
    return false;
  },
  release() {
    if (this.active > 0) this.active--;
  },
  getStats() {
    return {
      active: this.active,
      max: this.max,
      usage: (this.active / this.max * 100).toFixed(1) + '%'
    };
  }
};

const streamLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 100, // limit each IP to 100 requests per minute
    message: {
      error: 'Too many requests',
      message: 'Please try again later'
    },
    skip: (req) => {
      // Don't rate limit range requests (they're normal for video playback)
      return req.headers.range;
    }
  });

/**
 * Memory Pool Management for High Concurrency User Streaming
 */
class UserContentMemoryPool {
  constructor(maxSize = USER_STREAMING_CONFIG.MEMORY_POOL_SIZE) {
    this.pool = new Map();
    this.maxSize = maxSize;
    this.currentSize = 0;
    this.accessCount = new Map();
    this.lastCleanup = Date.now();
    this.cleanupInterval = 300000; // 5 minutes
  }

  get(key) {
    const item = this.pool.get(key);
    if (item) {
      item.lastAccessed = Date.now();
      this.accessCount.set(key, (this.accessCount.get(key) || 0) + 1);
      return item.data;
    }
    return null;
  }

  set(key, data, size) {
    // Auto-cleanup if needed
    this.autoCleanup();
    
    // Remove old items if we're over capacity
    while (this.currentSize + size > this.maxSize && this.pool.size > 0) {
      const oldestKey = this.getOldestKey();
      if (oldestKey) {
        this.remove(oldestKey);
      }
    }

    this.pool.set(key, {
      data,
      size,
      lastAccessed: Date.now(),
      createdAt: Date.now()
    });
    this.currentSize += size;
    this.accessCount.set(key, 1);
  }

  remove(key) {
    const item = this.pool.get(key);
    if (item) {
      this.currentSize -= item.size;
      this.pool.delete(key);
      this.accessCount.delete(key);
    }
  }

  getOldestKey() {
    let oldestKey = null;
    let oldestTime = Date.now();
    
    for (const [key, item] of this.pool) {
      if (item.lastAccessed < oldestTime) {
        oldestTime = item.lastAccessed;
        oldestKey = key;
      }
    }
    
    return oldestKey;
  }

  autoCleanup() {
    const now = Date.now();
    if (now - this.lastCleanup > this.cleanupInterval) {
      this.cleanup();
      this.lastCleanup = now;
    }
  }

  cleanup() {
    const now = Date.now();
    const maxAge = 1800000; // 30 minutes
    
    for (const [key, item] of this.pool) {
      if (now - item.lastAccessed > maxAge) {
        this.remove(key);
      }
    }
  }

  getStats() {
    return {
      poolSize: this.pool.size,
      currentSize: this.currentSize,
      maxSize: this.maxSize,
      utilization: (this.currentSize / this.maxSize) * 100
    };
  }

  clear() {
    this.pool.clear();
    this.accessCount.clear();
    this.currentSize = 0;
  }
}

// Initialize global memory pool for user streaming
const userContentPool = new UserContentMemoryPool();

/**
 * Optimized range request handler for user streaming
 */
const handleUserRangeRequest = (range, fileSize, contentType) => {
  if (!range) return null;
  
  // Parse range header
  const parts = range.replace(/bytes=/, "").split("-");
  const start = parseInt(parts[0], 10);
  const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
  
  // Validate range
  if (isNaN(start) || isNaN(end) || start >= fileSize || end >= fileSize || start > end) {
    return null;
  }
  
  // Optimize chunk size based on content type
  let chunkSize = USER_STREAMING_CONFIG.CHUNK_SIZES.default;
  if (contentType.includes('m3u8')) chunkSize = USER_STREAMING_CONFIG.CHUNK_SIZES.m3u8;
  else if (contentType.includes('mp2t')) chunkSize = USER_STREAMING_CONFIG.CHUNK_SIZES.ts;
  else if (contentType.includes('mp4')) chunkSize = USER_STREAMING_CONFIG.CHUNK_SIZES.mp4;
  
  // Calculate optimal range
  const rangeSize = end - start + 1;
  if (rangeSize <= chunkSize) {
    return { start, end, chunkSize: rangeSize };
  }
  
  // Limit range size for optimal performance
  const optimalEnd = Math.min(end, start + chunkSize - 1);
  return { start, end: optimalEnd, chunkSize: optimalEnd - start + 1 };
};

/**
 * Get cache headers for user streaming
 */
const getUserCacheHeaders = (filename, rangeInfo) => {
    const baseHeaders = {
        'Accept-Ranges': 'bytes',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        'Access-Control-Allow-Headers': 'Range, Accept, Accept-Encoding, Content-Type',
        'Access-Control-Expose-Headers': 'Content-Range, Accept-Ranges, Content-Length'
      };
  const ext = path.extname(filename).toLowerCase();
  let cacheDuration = USER_STREAMING_CONFIG.CACHE_DURATIONS.default;
  
  if (ext === '.m3u8') cacheDuration = USER_STREAMING_CONFIG.CACHE_DURATIONS.m3u8;
  else if (ext === '.ts') cacheDuration = USER_STREAMING_CONFIG.CACHE_DURATIONS.ts;
  else if (ext === '.mp4') cacheDuration = USER_STREAMING_CONFIG.CACHE_DURATIONS.mp4;
  
  if (ext === '.m3u8'){
    return {
        ...baseHeaders,
        'Cache-Control': `public, max-age=${cacheDuration}`,
        'Expires': new Date(Date.now() + cacheDuration * 1000).toUTCString(),
      };
  } else if (ext === '.ts'){
    return {
        ...baseHeaders,
        'Cache-Control': `public, max-age=${cacheDuration}`,
        'Expires': new Date(Date.now() + cacheDuration * 1000).toUTCString(),
        'ETag': `"${filename}-${rangeInfo ? rangeInfo.start : 'full'}"`
    }
  }else {
    return {
        ...baseHeaders,
        'Cache-Control': `public, max-age=${cacheDuration}`,
        'Expires': new Date(Date.now() + cacheDuration * 1000).toUTCString(),
        // 'Last-Modified': new Date().toUTCString()
      };
  }
  
};

router.use('/stream/video/:resourceId/:videoId/:filename', streamLimiter);
router.use('/stream/trailer/:resourceId/:videoId/:filename', streamLimiter);

router.use((req, res, next) => {
  const connectionId = Date.now() + '-' + Math.random().toString(36).substr(2, 9);

  connectionStates.set(connectionId, {
    url: req.url,
    startTime: Date.now(),
    clientIp: req.ip || req.connection.remoteAddress,
    state: 'processing'
  });

  req.connectionId = connectionId;

  res.on('finish', () => {
    const connection = connectionStates.get(connectionId);
    if (connection) {
      connection.state = 'completed';
      connection.duration = Date.now() - connection.startTime;
      console.log(`✅ Connection ${connectionId} completed in ${connection.duration}ms`);
      connectionStates.delete(connectionId);
    }
  });

  req.on('close', () => {
    const connection = connectionStates.get(connectionId);
    if (connection) {
      connection.state = 'aborted';
      connection.duration = Date.now() - connection.startTime;
      console.log(`⚠️ Connection ${connectionId} aborted after ${connection.duration}ms`);
      connectionStates.delete(connectionId);
    }
  });

  next();
});

/**
 * Get trailer streaming URLs for user consumption
 */
router.get('/trailer/:resourceId', async (req, res) => {
  try {
    const { resourceId } = req.params;
    const baseUrl = `${req.protocol}://${req.get('host')}/api/v1/userStreaming`;
    
    console.log(`🎬 User streaming: Getting trailer for resource: ${resourceId}`);
    
    // Query database to get trailer videos for this resource
    const videos = await prisma.video.findMany({
      where: {
        OR: [
         { filmId: resourceId},
         { episodeId: resourceId },
         { seasonId: resourceId }
        ],
       
        isTrailer: true // Only get trailers
      },
      select: {
        id: true,
        name: true,
        resolution: true,
        format: true,
       
        size: true,
        isTrailer: true
      },
      orderBy: {
        resolution: 'asc' // Order by resolution (SD, HD, FHD, UHD)
      }
    });

    if (videos.length === 0) {
      return res.json({
        success: false,
        message: 'No trailer found for this resource',
        resourceId
      });
    }

    console.log(`🎬 User streaming: Found ${videos.length} trailer(s) for resource ${resourceId}`);

    // Get the best quality trailer (usually HD or highest available)
    const bestTrailer = videos.find(v => v.resolution === 'HD') || 
                       videos.find(v => v.resolution === 'FHD') || 
                       videos.find(v => v.resolution === 'UHD') || 
                       videos[0];

    console.log(`🎬 User streaming: Selected trailer:`, bestTrailer);

    // Generate streaming URLs
    const response = {
      success: true,
      resourceId,
      trailer: {
        id: bestTrailer.id,
        name: bestTrailer.name,
        resolution: bestTrailer.resolution,
        format: bestTrailer.format,
        fileSize: bestTrailer.fileSize
      },
      streamingUrls: {
        hls: `${baseUrl}/stream/trailer/${resourceId}/${bestTrailer.id}/trailer_${bestTrailer.name}.m3u8`,
        direct: bestTrailer.url // Fallback to direct S3 URL
      },
      streamingConfig: {
        supportsRangeRequests: true,
        optimizedChunkSizes: USER_STREAMING_CONFIG.CHUNK_SIZES,
        cacheDurations: USER_STREAMING_CONFIG.CACHE_DURATIONS,
        maxRangeSize: USER_STREAMING_CONFIG.MAX_RANGE_SIZE
      }
    };

    console.log(`🎬 User streaming: Generated trailer URLs for ${resourceId}:`, response.streamingUrls);
    res.json(response);

  } catch (error) {
    console.error('❌ User streaming error getting trailer:', error);
    res.status(500).json({ 
      error: 'Failed to get trailer streaming URLs', 
      details: error.message 
    });
  }
});

/**
 * Stream trailer files for user consumption
 */
router.get('/stream/trailer/:resourceId/:videoId/:filename', async (req, res) => {
  let requestId = null;
  let s3Response = null;
  try {
    const { resourceId, videoId, filename } = req.params;
   
    const range = req.headers.range;

    // Generate unique request ID
    requestId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

     // Store request info for potential cancellation
     activeStreamRequests.set(requestId, {
      url: req.url,
      startTime: Date.now(),
      userId: req.userId,
      resourceId: req.params.resourceId
    });

    console.log(`🎬 User streaming: Trailer request: ${resourceId}/${videoId}/${filename} `);
    console.log(`📡 Range: ${range}`);

    // Handle client abort gracefully
    req.on('close', () => {
      console.log('⚠️ Client closed connection (likely seeking)');
      // Clean up any ongoing operations
      // Cancel the S3 request from queue
      // if (requestId) {
      //   s3UserRequestQueue.cancelRequest(requestId);
      //   activeStreamRequests.delete(requestId);
      // }
      
      // Clean up S3 response if it exists
      // if (s3Response && s3Response.Body && typeof s3Response.Body.destroy === 'function') {
      //   s3Response.Body.destroy();
      // }
    });

    // Query database to get the specific trailer video
    const video = await prisma.video.findFirst({
      where: {
        id: videoId,
        OR: [
          { filmId: resourceId },
          { episodeId: resourceId },
          { seasonId: resourceId }
        ],
        isTrailer: true
      },
      select: {
       url: true,
       name: true,
        hlsUrl: true,
            season: {
          select: {
            id: true,
            filmId: true
          }
        },
        size: true,
       
        format: true
      }
    });

    if (!video) {
      return res.status(404).json({ error: 'Trailer not found' });
    }

    console.log(`📋 User streaming: Found trailer: ${video.name}`);

     // Determine the correct file path based on resource type
     let actualResourcePath = resourceId;

       // Special handling for seasons: use seriesId-seasonId format
    if (video.season && video.season.filmId) {
      actualResourcePath = `${video.season.filmId}-${video.season.id}`;
    }

     // Extract base trailer name from the video
     const baseTrailerName = video.name.replace(/\.(m3u8|mp4)$/, ''); // Remove extension
     const cleanBaseName = baseTrailerName.replace(/^(HD_|trailer_)/, ''); // Remove HD_ and trailer_ prefixes

     console.log(`🎬 Base trailer name: ${cleanBaseName}`);

      // Determine file path based on filename for trailer structure
    let filePath;
    let contentType;

    console.log(`🔍 Analyzing trailer filename: ${filename}`);
    
    if (filename.includes('.m3u8')) {
      // Trailer HLS playlist - use the correct resource path (seriesId-seasonId for seasons)
      filePath = `${actualResourcePath}/hls_trailer/${filename}`;
      contentType = 'application/vnd.apple.mpegurl';
      console.log(`📋 Detected trailer HLS playlist: ${filePath}`);
      
    } else if (filename.includes('.ts')) {
      // Trailer HLS segment file - use the correct resource path (seriesId-seasonId for seasons)
      filePath = `${actualResourcePath}/hls_trailer/${filename}`;
      contentType = 'video/mp2t';
      console.log(`📋 Detected trailer HLS segment: ${filePath}`);
    } else {
      return res.status(400).json({ error: 'Unsupported trailer file type' });
    }

    

    console.log(`📁 User streaming: Extracted file path: ${filePath} from bucket`);

     // Check if client already disconnected
     if (req.aborted) {
      console.log('⚠️ Request aborted before streaming');
      return;
    }

    // Get file info from S3
    const headCommand = new GetObjectCommand({
      Bucket: process.env.DO_SPACESBUCKET,
      Key: filePath
    });

    const headResponse = await s3UserRequestQueue.add(()=>s3Client.send(headCommand));
    const fileSize = parseInt(headResponse.ContentLength);
    
    console.log(`📊 User streaming: File size: ${fileSize} bytes`);

   

    // Handle range requests with optimization
    const rangeInfo = handleUserRangeRequest(range, fileSize, contentType);
    
    if (rangeInfo) {
      console.log(`📦 User streaming: Streaming optimized chunk: ${rangeInfo.start}-${rangeInfo.end}/${fileSize} (${rangeInfo.chunkSize} bytes)`);

      // Set optimized headers for range request
      const headers = {
        'Content-Type': contentType,
        'Accept-Ranges': 'bytes',
        'Access-Control-Allow-Origin': '*',
        ...getUserCacheHeaders(filename)
      };

      headers['Content-Range'] = `bytes ${rangeInfo.start}-${rangeInfo.end}/${fileSize}`;
      headers['Content-Length'] = rangeInfo.chunkSize;

      res.writeHead(206, headers);

      // Stream the specific range with optimized buffer and connection pooling
      const getCommand = new GetObjectCommand({
        Bucket: process.env.DO_SPACESBUCKET,
        Key: filePath,
        Range: `bytes=${rangeInfo.start}-${rangeInfo.end}`
      });

      const stream = await s3UserRequestQueue.add(()=>s3Client.send(getCommand));
      
      s3Response = stream;
      // Optimize the stream with proper buffering and connection reuse
      const optimizedStream = stream.Body;
      optimizedStream.on('error', (error) => {
        console.error('❌ User streaming stream error:', error);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Streaming failed' });
        }
      });

      // Pipe with optimized buffer settings and connection pooling
      optimizedStream.pipe(res, {
        highWaterMark: USER_STREAMING_CONFIG.HIGH_WATER_MARK
      });

    } else {
      // Full file request with optimization
      console.log(`📦 User streaming: Streaming full file: ${fileSize} bytes`);

      const headers = {
        'Content-Type': contentType,
        'Accept-Ranges': 'bytes',
        'Access-Control-Allow-Origin': '*',
        ...getUserCacheHeaders(filename)
      };

      headers['Content-Length'] = fileSize;

      res.writeHead(200, headers);

      const getCommand = new GetObjectCommand({
        Bucket: process.env.DO_SPACESBUCKET,
        Key: filePath
      });

      const stream = await s3UserRequestQueue.add(()=>s3Client.send(getCommand));
      
      s3Response = stream;
      // Optimize the stream with connection pooling
      const optimizedStream = stream.Body;
      optimizedStream.on('error', (error) => {
        console.error('❌ User streaming stream error:', error);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Streaming failed' });
        }
      });

      // Pipe with optimized buffer settings and connection reuse
      optimizedStream.pipe(res, {
        highWaterMark: USER_STREAMING_CONFIG.HIGH_WATER_MARK
      });
    }

  } catch (error) {
    console.error('❌ User streaming trailer error:', error);
    
    if (error.name === 'NoSuchKey') {
      return res.status(404).json({ error: 'File not found' });
    }
    
    if (!res.headersSent) {
      res.status(500).json({ error: 'Trailer streaming failed', details: error.message });
    }
    if (!req.aborted && !res.headersSent) {
      handleStreamError(error, res);
    } else {
      console.log('⚠️ Error occurred after client disconnected:', error.message);
    }
  }finally {
    // Clean up request tracking
    // if (requestId) {
    //   activeStreamRequests.delete(requestId);
    // }
    
    // Clean up S3 response
    // if (s3Response && s3Response.Body && typeof s3Response.Body.destroy === 'function') {
    //   s3Response.Body.destroy();
    // }
  }
});




/**
 * Get streaming URLs for user consumption
 */
router.get('/urls/:resourceId',   verifyToken, async (req, res) => {
  try {
    const { resourceId } = req.params;
    const userId = req.userId; // Get user ID from auth middleware
    const baseUrl = `${req.protocol}://${req.get('host')}/api/v1/userStreaming`;
    
    console.log(`🎬 User streaming: Getting URLs for resource: ${resourceId} for user: ${userId}`);
    
    // First, check if this is a film, episode, or season and get access permissions
    let resourceType = 'film';
    let resourceData = null;
    let hasAccess = false;
    let isFree = false;
    
    // Check if it's a film
    const film = await prisma.film.findUnique({
      where: { id: resourceId },
      include: {
        pricing: {
          include: { priceList: true }
        },
        purchase: { 
          where: { 
            userId: userId, 
            valid: true,
            expiresAt: { gt: new Date() }
          } 
        }
      }
    });
    
    if (film) {
      resourceType = 'film';
      resourceData = film;
      
      // Check if film is free through the access property
      isFree = film.access === 'free';
      
      // Check if user has valid purchase
      hasAccess = isFree || film.purchase.length > 0;
      
      console.log(`🎬 User streaming: Film "${film.title}" - Access: ${film.access}, Free: ${isFree}, Has Access: ${hasAccess}`);
    } else {
      // Check if it's an episode
      const episode = await prisma.episode.findUnique({
        where: { id: resourceId },
        include: {
          season: {
            include: {
              pricing: {
                include: { priceList: true }
              },
              purchase: { 
                where: { 
                  userId: userId, 
                  valid: true,
                  expiresAt: { gt: new Date() }
                } 
              }
            }
          }
        }
      });
      
      if (episode) {
        resourceType = 'episode';
        resourceData = episode;
        
        // Check if episode's season is free through the access property
        isFree = episode.season.access === 'free';
        
        // Check if user has valid purchase for the season
        hasAccess = isFree || episode.season.purchase.length > 0;
        
        console.log(`🎬 User streaming: Episode "${episode.title}" from season "${episode.season.title}" - Access: ${episode.season.access}, Free: ${isFree}, Has Access: ${hasAccess}`);
      } else {
        // Check if it's a season
        const season = await prisma.season.findUnique({
          where: { id: resourceId },
          include: {
            pricing: {
              include: { priceList: true }
            },
            purchase: { 
              where: { 
                userId: userId, 
                valid: true,
                expiresAt: { gt: new Date() }
              } 
            }
          }
        });
        
        if (season) {
          resourceType = 'season';
          resourceData = season;
          
          // Check if season is free through the access property
          isFree = season.access === 'free';
          
          // Check if user has valid purchase
          hasAccess = isFree || season.purchase.length > 0;
          
          console.log(`🎬 User streaming: Season "${season.title}" - Access: ${season.access}, Free: ${isFree}, Has Access: ${hasAccess}`);
        } else {
          return res.status(404).json({ error: 'Resource not found' });
        }
      }
    }
    
    // If user doesn't have access, return error
    if (!hasAccess) {
      console.log(`🚫 User streaming: Access denied for user ${userId} to resource ${resourceId}`);
      return res.status(403).json({ 
        error: 'Access denied', 
        message: 'This content requires purchase or is not available',
        resourceType,
        resourceId
      });
    }

    // Get purchased resolutions if this is a paid purchase
    let purchasedResolutions = [];
    if (!isFree && resourceData.purchase && resourceData.purchase.length > 0) {
      // Get the most recent valid purchase
      const latestPurchase = resourceData.purchase[0]; // Already sorted by valid: true and expiresAt
      if (latestPurchase && latestPurchase.resolutions && Array.isArray(latestPurchase.resolutions)) {
        purchasedResolutions = latestPurchase.resolutions.map(r => r.toLowerCase());
        console.log(`💰 User streaming: User ${userId} purchased resolutions:`, purchasedResolutions);
      }
    }

    // Query database to get all videos for this resource
    const videos = await prisma.video.findMany({
      where: {
        OR: [
          { filmId: resourceId },
          { episodeId: resourceId },
          { seasonId: resourceId }
        ]
      },
      select: {
        id: true,
        name: true,
        resolution: true,
        format: true,
        isTrailer: true,
        url: true,
        hlsUrl: true
      }
    });

    if (videos.length === 0) {
      return res.status(404).json({ error: 'No videos found for this resource' });
    }

    console.log(`📋 User streaming: Found ${videos.length} videos for resource ${resourceId}`);
    console.log(`📋 User streaming: All videos details:`, videos.map(v => ({
      id: v.id,
      name: v.name,
      resolution: v.resolution,
      format: v.format,
      isTrailer: v.isTrailer
    })));

    // Separate trailers from regular videos
    const trailerVideos = videos.filter(v => v.isTrailer === true);
    const regularVideos = videos.filter(v => v.isTrailer !== true);
    
    console.log(`🎬 User streaming: Found ${trailerVideos.length} trailer(s) and ${regularVideos.length} regular video(s)`);

    // Filter regular videos based on access level
    let accessibleVideos = regularVideos;
    if (!isFree && purchasedResolutions.length > 0) {
      // For purchased content, only show videos matching purchased resolutions
      accessibleVideos = regularVideos.filter(video => {
        if (!video.resolution) return false;
        const videoRes = video.resolution.toLowerCase();
        return purchasedResolutions.includes(videoRes);
      });
      console.log(`💰 User streaming: Filtered to ${accessibleVideos.length} accessible videos based on purchased resolutions:`, purchasedResolutions);
    } else {
      console.log(`🆓 User streaming: Free content - all ${regularVideos.length} resolutions available`);
    }

    // Initialize response object
    const response = {
      success: true,
      resourceId,
      resourceType,
      baseUrl,
      videoCount: videos.length,
      trailerCount: trailerVideos.length,
      regularVideoCount: regularVideos.length,
      accessibleVideoCount: accessibleVideos.length,
      accessInfo: {
        isFree,
        hasAccess,
        accessType: isFree ? 'free' : 'purchased',
        purchasedResolutions: isFree ? null : purchasedResolutions
      }
    };

    // Handle trailer URLs if trailers exist (trailers are always accessible)
    if (trailerVideos.length > 0) {
      const trailerVideo = trailerVideos[0]; // Use the first trailer
      console.log(`🎬 User streaming: Processing trailer video:`, trailerVideo);
      
      // Extract base trailer name for URL generation
      const baseTrailerName = trailerVideo.name.replace(/\.(m3u8|mp4)$/, '');
      const cleanTrailerName = baseTrailerName.replace(/^(HD_|trailer_)/, '');
      
      response.trailerUrls = {
        mp4: null, // Trailers don't have MP4 fallback
        hls: {
          // Use the dedicated trailer streaming endpoint
          trailer: `${baseUrl}/stream/trailer/${resourceId}/${trailerVideo.id}/trailer_${cleanTrailerName}.m3u8`
        }
      };
      
      response.trailerInfo = {
        id: trailerVideo.id,
        name: trailerVideo.name,
        resolution: trailerVideo.resolution,
        format: trailerVideo.format,
        cleanName: cleanTrailerName
      };
      
      console.log(`🔗 User streaming: Generated trailer streaming URLs for ${resourceId}:`, response.trailerUrls);
    }

    // Handle regular video URLs if regular videos exist (only if user has access)
    if (accessibleVideos.length > 0) { // Changed to accessibleVideos
      // Extract base video name from the first regular video
      const firstVideo = accessibleVideos[0]; // Changed to accessibleVideos
      const baseVideoName = firstVideo.name.replace(/\.(m3u8|mp4)$/, ''); // Remove extension
      const cleanBaseName = baseVideoName.replace(/^(SD_|HD_|FHD_|UHD_|master_)/, '');

      console.log(`🎬 User streaming: Base video name for regular videos: ${cleanBaseName}`);

      // Find video ids for each resolution
      const getVideoIdByResolution = (resLabel) => {
        if (resLabel === 'master') {
          return firstVideo.id;
        }
        
        // For free content, search in all regular videos
        // For paid content, search in accessible videos only
        const searchVideos = isFree ? regularVideos : accessibleVideos;
        
        const found = searchVideos.find(
          v => v.resolution && v.resolution.toLowerCase() === resLabel
        );
        return found ? found.id : null;
      };

      // Generate dynamic streaming URLs for regular videos using the regular video endpoint
      const availableHlsUrls = {};
      
      // Always include master if available
      const masterVideoId = getVideoIdByResolution('master');
      if (masterVideoId) {
        // availableHlsUrls.master = `${baseUrl}/stream/video/${resourceId}/${masterVideoId}/master_${cleanBaseName}.m3u8`;
      }
      
      if (isFree) {
        // 🆓 Free content: Set ALL available streaming URLs (all resolutions)
        console.log(`🆓 User streaming: Free content - generating URLs for all available resolutions`);
        console.log(`🆓 User streaming: All regular videos found:`, regularVideos.map(v => ({ id: v.id, resolution: v.resolution, name: v.name })));
        
        // Get all videos (not just accessible ones) for free content
        const allRegularVideos = regularVideos.filter(v => v.isTrailer !== true);
        console.log(`🆓 User streaming: Filtered regular videos (no trailers):`, allRegularVideos.map(v => ({ id: v.id, resolution: v.resolution, name: v.name })));
        
        // Generate URLs for ALL available resolutions
        allRegularVideos.forEach(video => {
          if (video.resolution && video.resolution.toLowerCase() !== 'master') {
            const resKey = video.resolution.toLowerCase();
            const resLabel = video.resolution.toUpperCase();
            availableHlsUrls[resKey] = `${baseUrl}/stream/video/${resourceId}/${video.id}/${resLabel}_${cleanBaseName}.m3u8`;
            console.log(`🆓 User streaming: Added ${resKey} resolution URL for video ${video.id} with name: ${video.name}`);
          }
        });
        
        // Also try to generate URLs using the getVideoIdByResolution function for consistency
        console.log(`🆓 User streaming: Testing getVideoIdByResolution for all resolutions...`);
        ['sd', 'hd', 'fhd', 'uhd'].forEach(resKey => {
          const videoId = getVideoIdByResolution(resKey);
          if (videoId) {
            const resLabel = resKey.toUpperCase();
            if (!availableHlsUrls[resKey]) {
              availableHlsUrls[resKey] = `${baseUrl}/stream/video/${resourceId}/${videoId}/${resLabel}_${cleanBaseName}.m3u8`;
              console.log(`🆓 User streaming: Added ${resKey} resolution URL via getVideoIdByResolution for video ${videoId}`);
            }
          } else {
            console.log(`🆓 User streaming: No video found for ${resKey} resolution`);
          }
        });
        
        console.log(`🆓 User streaming: Generated URLs for all ${Object.keys(availableHlsUrls).length - 1} available resolutions (free content)`);
        console.log(`🆓 User streaming: Final availableHlsUrls:`, Object.keys(availableHlsUrls));
        console.log(`🆓 User streaming: Full availableHlsUrls object:`, availableHlsUrls);
      } else {
        // 💰 Paid content: Only set streaming URLs for purchased resolutions
        console.log(`💰 User streaming: Paid content - generating URLs only for purchased resolutions:`, purchasedResolutions);
        console.log(`💰 User streaming: Accessible videos (purchased):`, accessibleVideos.map(v => ({ id: v.id, resolution: v.resolution, name: v.name })));
        
        // Only generate URLs for resolutions that exist in accessibleVideos (purchased ones)
        accessibleVideos.forEach(video => {
          if (video.resolution && video.resolution.toLowerCase() !== 'master') {
            const resKey = video.resolution.toLowerCase();
            const resLabel = video.resolution.toUpperCase();
            availableHlsUrls[resKey] = `${baseUrl}/stream/video/${resourceId}/${video.id}/${resLabel}_${cleanBaseName}.m3u8`;
            console.log(`💰 User streaming: Generated URLs for ${Object.keys(availableHlsUrls).length - 1} purchased resolutions`);
            console.log(`💰 User streaming: Final availableHlsUrls:`, Object.keys(availableHlsUrls));
          }
        });
      }
      
      response.streamingUrls = {
        mp4: `${baseUrl}/stream/video/${resourceId}/${firstVideo.id}/original_${cleanBaseName}.mp4`,
        hls: availableHlsUrls
      };

      response.baseVideoName = cleanBaseName;
      response.videoIds = accessibleVideos.map(v => ({ id: v.id, resolution: v.resolution })); // Changed to accessibleVideos

      console.log(`🔗 User streaming: Generated regular video streaming URLs for ${resourceId}:`, response.streamingUrls);
    }

    // Add streaming configuration info
    response.streamingConfig = {
      supportsRangeRequests: true,
      optimizedChunkSizes: USER_STREAMING_CONFIG.CHUNK_SIZES,
      cacheDurations: USER_STREAMING_CONFIG.CACHE_DURATIONS,
      maxRangeSize: USER_STREAMING_CONFIG.MAX_RANGE_SIZE
    };

    // Add backward compatibility flags
    response.hasTrailer = trailerVideos.length > 0;
    response.hasRegularVideos = regularVideos.length > 0;

    console.log(`📋 User streaming: Final response summary:`, {
      resourceId,
      resourceType,
      totalVideos: videos.length,
      trailers: trailerVideos.length,
      regularVideos: regularVideos.length,
      hasTrailerUrls: !!response.trailerUrls,
      hasStreamingUrls: !!response.streamingUrls,
      accessInfo: response.accessInfo
    });

    res.json(response);

  } catch (error) {
    console.error('❌ User streaming error generating streaming URLs:', error);
    res.status(500).json({ error: 'Failed to generate streaming URLs', details: error.message });
  }
});

/**
 * Stream regular video files for user consumption
 */
router.get('/stream/video/:resourceId/:videoId/:filename', async (req, res) => {
    let s3Response = null;
  try {
    const { resourceId, videoId, filename } = req.params;
    
    // Verify token from query parameter or Authorization header
    const tokenInfo = verifyStreamingToken(req);
    if (!tokenInfo.isValid) {
      return res.status(401).json({ error: 'Unauthorized', message: 'Invalid or missing token' });
    }
    
    const userId = tokenInfo.userId;
    const range = req.headers.range;

    console.log(`🎬 User streaming: Video request: ${resourceId}/${videoId}/${filename} from user: ${userId}`);
    console.log(`📡 Range: ${range}`);

    // Check access permissions before streaming
    let hasAccess = false;
    let isFree = false;
    
    // Check if it's a film
    const film = await prisma.film.findUnique({
      where: { id: resourceId },
      include: {
        purchase: { 
          where: { 
            userId: userId, 
            valid: true,
            expiresAt: { gt: new Date() }
          } 
        }
      }
    });
    
    if (film) {
      // Check if film is free through the access property
      isFree = film.access === 'free';
      
      // Check if user has valid purchase
      hasAccess = isFree || film.purchase.length > 0;
      
      console.log(`🎬 User streaming: Film "${film.title}" - Access: ${film.access}, Free: ${isFree}, Has Access: ${hasAccess}`);
    } else {
      // Check if it's an episode
      const episode = await prisma.episode.findUnique({
        where: { id: resourceId },
        include: {
          season: {
            include: {
              pricing: {
                include: { priceList: true }
              },
              purchase: { 
                where: { 
                  userId: userId, 
                  valid: true,
                  expiresAt: { gt: new Date() }
                } 
              }
            }
          }
        }
      });
      
      if (episode) {
         // Check if episode's season is free through the access property
         isFree = episode.season.access === 'free';
        // Check if user has valid purchase for the season
        hasAccess = isFree || episode.season.purchase.length > 0;
        
        console.log(`🎬 User streaming: Episode "${episode.title}" from season "${episode.season.title}" - Free: ${isFree}, Has Access: ${hasAccess}`);
      } else {
        // Check if it's a season
        const season = await prisma.season.findUnique({
          where: { id: resourceId },
          include: {
            pricing: {
              include: { priceList: true }
            },
            purchase: { 
              where: { 
                userId: userId, 
                valid: true,
                expiresAt: { gt: new Date() }
              } 
            }
          }
        });
        
        if (season) {
            // Check if season is free through the access property
            isFree = season.access === 'free';
          // Check if user has valid purchase
          hasAccess = isFree || season.purchase.length > 0;
          
          console.log(`🎬 User streaming: Season "${season.title}" - Free: ${isFree}, Has Access: ${hasAccess}`);
        } else {
          return res.status(404).json({ error: 'Resource not found' });
        }
      }
    }
    
    // If user doesn't have access, return error
    if (!hasAccess) {
      console.log(`🚫 User streaming: Access denied for user ${userId} to resource ${resourceId}`);
      return res.status(403).json({ 
        error: 'Access denied', 
        message: 'This content requires purchase or is not available',
        resourceId
      });
    }

    // Query database to get the specific video
    const video = await prisma.video.findFirst({
      where: {
        id: videoId,
        OR: [
          { filmId: resourceId },
          { episodeId: resourceId },
          { seasonId: resourceId }
        ]
      },
      select: {
        name: true,
        resolution: true,
        format: true,
        url: true,
        hlsUrl: true,
        episode:{
          select:{
            id:true,
            season:{
              select:{
                id:true,
                filmId:true
              }
            }
          }
        },
        seasonId:true,
        season: {
          select: {
            id: true,
            filmId: true
          }
        }
      }
    });

    if (!video) {
      return res.status(404).json({ error: 'Video not found' });
    }

    console.log(`📋 User streaming: Found video: ${video.name} (${video.resolution})`);

    // Extract base video name from the video
    const baseVideoName = video.name.replace(/\.(m3u8|mp4)$/, ''); // Remove extension
    const cleanBaseName = baseVideoName.replace(/^(SD_|HD_|FHD_|UHD_|master_)/, ''); // Remove resolution and master prefixes
    
    console.log(`🎬 User streaming: Base video name: ${cleanBaseName}`);
    console.log(`🎬 User streaming: Video resolution: ${video.resolution}`);

    // Determine file path based on filename and video resolution
    let filePath;
    let contentType;
    
    console.log(`🔍 User streaming: Analyzing filename: ${filename}`);

      // Determine the correct file path based on resource type
      let actualResourcePath = resourceId;

             // Special handling for seasons: use seriesId-seasonId format
    if (video.season && video.season.filmId) {
      actualResourcePath = `${video.season.filmId}-${video.season.id}`;
      console.log(`🎬 Season trailer detected - using path: ${actualResourcePath} (seriesId-seasonId format)`);
    } else if (video.episode && video.episode.season && video.episode.season.filmId) {
      actualResourcePath = `${video.episode.season.filmId}-${video.episode.season.id}`;
      console.log(`🎬 Episode trailer detected - using path: ${actualResourcePath} (seriesId-seasonId format)`);
    }
    
    if (filename.includes('.m3u8')) {
      // Check if this is a master playlist
        filePath = `${actualResourcePath}/hls_${video.resolution}_${cleanBaseName}/${filename}`;
        contentType = 'application/vnd.apple.mpegurl';
        console.log(`📋 User streaming: Detected HLS playlist: ${filePath}`);
      
    } else if (filename.includes('.ts')) {
      // HLS segment file - use video resolution from database
      filePath = `${actualResourcePath}/hls_${video.resolution}_${cleanBaseName}/${filename}`;
      contentType = 'video/mp2t';
      console.log(`📋 User streaming: Detected HLS segment: ${filePath}`);
    } else if (filename.includes('.mp4')) {
      // MP4 file - uploaded directly to bucket root
      filePath = `original_${cleanBaseName}.mp4`;
      contentType = 'video/mp4';
      console.log(`📋 User streaming: Detected MP4 file: ${filePath}`);
    } else if (filename.includes('.vtt')) {
      // Subtitle file - from shared subtitle directory
      filePath = `${actualResourcePath}/subtitles/${cleanBaseName}/${filename}`;
      contentType = 'text/vtt';
      console.log(`📋 User streaming: Detected subtitle file: ${filename} (${cleanBaseName})`);
      console.log(`📝 User streaming: Streaming subtitle file: ${filename} (${cleanBaseName})`);
    } else {
      return res.status(400).json({ error: 'Unsupported file type' });
    }

    console.log(`📁 User streaming: File path: ${filePath}`);

    // Optimized S3 request with connection pooling
    const headCommand = new GetObjectCommand({
      Bucket: process.env.DO_SPACESBUCKET,
      Key: filePath
    });

    const headResponse = await s3UserRequestQueue.add(()=> s3Client.send(headCommand));
    const fileSize = parseInt(headResponse.ContentLength);
    
    console.log(`📊 User streaming: File size: ${fileSize} bytes`);

    // Handle range requests with optimization
    const rangeInfo = handleUserRangeRequest(range, fileSize, contentType, filename);
    
    if (rangeInfo) {
      console.log(`📦 User streaming: Streaming optimized chunk: ${rangeInfo.start}-${rangeInfo.end}/${fileSize} (${rangeInfo.chunkSize} bytes)`);

      // Set optimized headers for range request
      const headers = {
        'Content-Type': contentType,
        
        // Enhanced CORS headers for subtitle files
        // ...(contentType === 'text/vtt' && {
        //   'Access-Control-Allow-Credentials': 'true',
        //   'Access-Control-Max-Age': '86400'
        // }),
        ...getUserCacheHeaders(filename)
      };

      headers['Content-Range'] = `bytes ${rangeInfo.start}-${rangeInfo.end}/${fileSize}`;
      headers['Content-Length'] = rangeInfo.chunkSize;


      res.writeHead(206, headers);

      // Stream the specific range with optimized buffer and connection pooling
      const getCommand = new GetObjectCommand({
        Bucket: process.env.DO_SPACESBUCKET,
        Key: filePath,
        Range: `bytes=${rangeInfo.start}-${rangeInfo.end}`
      });

      const stream = await s3UserRequestQueue.add(()=>s3Client.send(getCommand));
      
      // Optimize the stream with proper buffering and connection reuse
      const optimizedStream = stream.Body;
      optimizedStream.on('error', (error) => {
        console.error('❌ User streaming stream error:', error);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Streaming failed' });
        }
      });

      // Pipe with optimized buffer settings and connection pooling
      optimizedStream.pipe(res, {
        highWaterMark: USER_STREAMING_CONFIG.HIGH_WATER_MARK
      });

    } else {
      // Full file request with optimization
      console.log(`📦 User streaming: Streaming full file: ${fileSize} bytes`);

      const headers = {
        'Content-Type': contentType,
       
        // Enhanced CORS headers for subtitle files
        // ...(contentType === 'text/vtt' && {
        //   'Access-Control-Allow-Credentials': 'true',
        //   'Access-Control-Max-Age': '86400'
        // }),
        ...getUserCacheHeaders(filename)
      };

      headers['Content-Length'] = fileSize;

      res.writeHead(200, headers);

      const getCommand = new GetObjectCommand({
        Bucket: process.env.DO_SPACESBUCKET,
        Key: filePath
      });

      const stream = await s3UserRequestQueue.add(()=> s3Client.send(getCommand));
      
      // Optimize the stream with connection pooling
      const optimizedStream = stream.Body;
      optimizedStream.on('error', (error) => {
        console.error('❌ User streaming stream error:', error);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Streaming failed' });
        }
      });

      // Pipe with optimized buffer settings and connection reuse
      optimizedStream.pipe(res, {
        highWaterMark: USER_STREAMING_CONFIG.HIGH_WATER_MARK
      });
    }

  } catch (error) {
    console.error('Streaming error:', error);
    if (!req.aborted && !res.headersSent) {
      handleStreamError(error, res);
    } else {
      console.log('⚠️ Error occurred after client disconnected:', error.message);
    }
  }finally {
     // Clean up S3 response
     if (s3Response && s3Response.Body && typeof s3Response.Body.destroy === 'function') {
        s3Response.Body.destroy();
      }
  }
});


/**
 * OPTIONS endpoint for regular video CORS preflight requests
 */
router.options('/stream/video/:resourceId/:videoId/:filename', (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Range, Accept, Accept-Encoding, Content-Type'); // FIXED: Added missing headers
    res.setHeader('Access-Control-Max-Age', '86400');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Accept-Ranges, Content-Length'); 
    res.status(200).end();
});

/**
 * OPTIONS endpoint for trailer CORS preflight requests
 */
router.options('/stream/trailer/:resourceId/:videoId/:filename', (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Range, Accept, Accept-Encoding, Content-Type'); // FIXED
  res.setHeader('Access-Control-Max-Age', '86400');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Accept-Ranges, Content-Length'); // Add this
  res.status(200).end();
  });

/**
 * Get subtitle files for a video resource
 */
router.get('/subtitles/:resourceId', async (req, res) => {
  try {
    const { resourceId } = req.params;
    
    // Verify token from query parameter or Authorization header
    const tokenInfo = verifyStreamingToken(req);
    if (!tokenInfo.isValid) {
      return res.status(401).json({ error: 'Unauthorized', message: 'Invalid or missing token' });
    }
    
    const baseUrl = `${req.protocol}://${req.get('host')}/api/v1/userStreaming`;
    
    const userId = tokenInfo.userId;
    console.log(`📝 User streaming: Getting subtitle files for resource: ${resourceId} for user: ${userId}`);
    
    // Query database to get subtitle records for this resource
    const subtitleRecords = await prisma.subtitle.findMany({
      where: {
        resourceId: resourceId
      },
      select: {
        id: true,
        filename: true,
        language: true,
        label: true, // Include the label field
        s3Url: true,
        fileSize: true,
        createdAt: true
      },
      orderBy: {
        createdAt: 'asc'
      }
    });

    console.log(`📝 User streaming: Found ${subtitleRecords.length} subtitle records in database for resource: ${resourceId}`);

    if (subtitleRecords.length === 0) {
      return res.json({
        success: true,
        resourceId,
        subtitles: [],
        subtitleCount: 0,
        message: 'No subtitles found for this resource'
      });
    }

    // Transform subtitle records to match the expected format
    const availableSubtitles = subtitleRecords.map((subtitle, index) => {
      // Get language name for display
      const getLanguageName = (code) => {
        const languageNames = {
          'eng': 'English',
          'spa': 'Spanish',
          'fra': 'French',
          'deu': 'German',
          'ita': 'Italian',
          'por': 'Portuguese',
          'rus': 'Russian',
          'jpn': 'Japanese',
          'kor': 'Korean',
          'chi': 'Chinese',
          'ara': 'Arabic',
          'hin': 'Hindi',
          'ben': 'Bengali',
          'tel': 'Telugu',
          'tam': 'Tamil',
          'mar': 'Marathi',
          'guj': 'Gujarati',
          'kan': 'Kannada',
          'mal': 'Malayalam',
          'urd': 'Urdu',
          'swa': 'Swahili',
          'zul': 'Zulu',
          'xho': 'Xhosa',
          'afr': 'Afrikaans',
          'nld': 'Dutch',
          'swe': 'Swedish',
          'nor': 'Norwegian',
          'dan': 'Danish',
          'fin': 'Finnish',
          'pol': 'Polish',
          'cze': 'Czech',
          'slk': 'Slovak',
          'hun': 'Hungarian',
          'rom': 'Romanian',
          'bul': 'Bulgarian',
          'hrv': 'Croatian',
          'srp': 'Serbian',
          'slv': 'Slovenian',
          'est': 'Estonian',
          'lav': 'Latvian',
          'lit': 'Lithuanian',
          'tur': 'Turkish',
          'ell': 'Greek',
          'heb': 'Hebrew',
          'fas': 'Persian',
          'tha': 'Thai',
          'vie': 'Vietnamese',
          'ind': 'Indonesian',
          'msa': 'Malay',
          'fil': 'Filipino',
          'tgl': 'Tagalog'
        };
        return languageNames[code] || code;
      };

      const languageName = getLanguageName(subtitle.language);
      
      // Create server URL for subtitle streaming to avoid CORS issues
      const serverUrl = `${baseUrl}/subtitle/${resourceId}/${subtitle.id}/${subtitle.filename}`;
            
      return {
        id: subtitle.id,
        language: subtitle.language,
        languageName: languageName,
        filename: subtitle.filename,
        url: serverUrl, // Use server URL instead of S3 URL to avoid CORS
        s3Url: subtitle.s3Url, // Keep S3 URL for reference
        label: subtitle.label || `${languageName} (${subtitle.language.toUpperCase()})`, // Use database label or fall back to generated
        size: subtitle.fileSize,
        createdAt: subtitle.createdAt
      };
    });
          
    console.log(`📝 User streaming: Returning ${availableSubtitles.length} subtitle files for ${resourceId}:`, 
      availableSubtitles.map(s => `${s.languageName} (${s.language})`));
          
    res.json({
      success: true,
      resourceId,
      subtitles: availableSubtitles,
      subtitleCount: availableSubtitles.length,
      message: `Found ${availableSubtitles.length} subtitle(s) for this resource`
    });

  } catch (error) {
    console.error('❌ User streaming error getting subtitle files:', error);
    res.status(500).json({ 
      error: 'Failed to get subtitle files', 
      details: error.message 
    });
  }
});


// Add aggressive caching for subtitles
const getSubtitleCacheHeaders = (filename) => {
    return {
      'Cache-Control': 'public, max-age=86400', // 24 hours
      'Expires': new Date(Date.now() + 86400000).toUTCString()
    };
  };
  
  // Separate CORS headers
  const getSubtitleCorsHeaders = () => {
    return {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': 'Range, Accept, Accept-Encoding, If-Range, If-Modified-Since, Content-Type',
      'Access-Control-Expose-Headers': 'Content-Range, Accept-Ranges, Content-Length, Content-Type',
      'Access-Control-Max-Age': '86400',
      'Access-Control-Allow-Credentials': 'true'
    };
  };

/**
 * Stream subtitle files
 */
router.get('/subtitle/:resourceId/:subtitleId/:filename', async (req, res) => {
  try {
    const { resourceId, subtitleId, filename } = req.params;
    
    // Verify token from query parameter or Authorization header
    const tokenInfo = verifyStreamingToken(req);
    if (!tokenInfo.isValid) {
      return res.status(401).json({ error: 'Unauthorized', message: 'Invalid or missing token' });
    }
    
    const userId = tokenInfo.userId;
    const range = req.headers.range;

    console.log(`🎬 User streaming: Subtitle streaming request: ${resourceId}/${subtitleId}/${filename} from user: ${userId}`);
    console.log(`📡 Range: ${range}`);

    // Subtitles are freely accessible to everyone - no access restrictions needed
    console.log(`📝 User streaming: Subtitle access granted - subtitles are free for all users`);

    // Query database to get the specific subtitle by ID
    const subtitle = await prisma.subtitle.findFirst({
      where: {
        id: subtitleId,
        resourceId: resourceId
      },
      select: {
        s3Url: true,
        fileSize: true,
        filename: true,
        language: true
      }
    });

    if (!subtitle) {
      return res.status(404).json({ error: 'Subtitle not found' });
    }

    console.log(`📋 User streaming: Found subtitle: ${subtitle.filename} (${subtitle.language})`);

    // Extract the file path from the S3 URL
    // S3 URL format: https://nyati-cdn.sfo3.digitaloceanspaces.com/bucket-name/file-path
    const s3UrlParts = subtitle.s3Url.split('/');
    const bucketName = s3UrlParts[3]; // bucket-name
    const filePath = s3UrlParts.slice(3).join('/'); // file-path

    console.log(`📁 User streaming: Extracted file path: ${filePath} from bucket: ${bucketName}`);

    // Optimized S3 request with connection pooling
    const headCommand = new GetObjectCommand({
      Bucket: process.env.DO_SPACESBUCKET,
      Key: filePath
    });

    const headResponse = await s3UserSubtitleQueue.add(()=>s3Client.send(headCommand));
    const fileSize = parseInt(headResponse.ContentLength);
    
    console.log(`📊 User streaming: File size: ${fileSize} bytes`);

    // Handle range requests with optimization
    const rangeInfo = handleUserRangeRequest(range, fileSize, 'text/vtt'); // Subtitle is always text/vtt
    
    if (rangeInfo) {
      console.log(`📦 User streaming: Streaming optimized chunk: ${rangeInfo.start}-${rangeInfo.end}/${fileSize} (${rangeInfo.chunkSize} bytes)`);

      // Set optimized headers for range request
      const headers = {
        ...getSubtitleCorsHeaders(), // CORS headers first
        ...getSubtitleCacheHeaders(filename), // Then cache headers
        'Content-Type': 'text/vtt',
        'Accept-Ranges': 'bytes',
        'Content-Range': `bytes ${rangeInfo.start}-${rangeInfo.end}/${fileSize}`,
      
        'Content-Length': rangeInfo.chunkSize,
      };

      res.writeHead(206, headers);

      // Stream the specific range with optimized buffer and connection pooling
      const getCommand = new GetObjectCommand({
        Bucket: process.env.DO_SPACESBUCKET,
        Key: filePath,
        Range: `bytes=${rangeInfo.start}-${rangeInfo.end}`
      });

      const stream = await s3UserSubtitleQueue.add(()=> s3Client.send(getCommand));
      
      // Optimize the stream with proper buffering and connection reuse
      const optimizedStream = stream.Body;
      optimizedStream.on('error', (error) => {
        console.error('❌ User streaming stream error:', error);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Streaming failed' });
        }
      });

      // Pipe with optimized buffer settings and connection pooling
      optimizedStream.pipe(res, {
        highWaterMark: USER_STREAMING_CONFIG.HIGH_WATER_MARK
      });

    } else {
      // Full file request with optimization
      console.log(`📦 User streaming: Streaming full file: ${fileSize} bytes`);

      const headers = {
        ...getSubtitleCorsHeaders(), // CORS headers first
        ...getSubtitleCacheHeaders(filename), // Then cache headers
        'Content-Type': 'text/vtt',
        'Accept-Ranges': 'bytes',
        'Content-Length': fileSize,
      };

      res.writeHead(200, headers);

      const getCommand = new GetObjectCommand({
          Bucket: process.env.DO_SPACESBUCKET,
        Key: filePath
      });

      const stream = await s3UserSubtitleQueue.add(()=>s3Client.send(getCommand));
      
      // Optimize the stream with connection pooling
      const optimizedStream = stream.Body;
      optimizedStream.on('error', (error) => {
        console.error('❌ User streaming stream error:', error);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Streaming failed' });
        }
      });

      // Pipe with optimized buffer settings and connection reuse
      optimizedStream.pipe(res, {
        highWaterMark: USER_STREAMING_CONFIG.HIGH_WATER_MARK
      });
    }

      } catch (error) {
    console.error('❌ User streaming subtitle streaming error:', error);
    
    if (error.name === 'NoSuchKey') {
      return res.status(404).json({ error: 'File not found' });
    }
    
    if (!res.headersSent) {
    res.status(500).json({ error: 'Subtitle streaming failed', details: error.message });
    }
  }
});


/**
 * OPTIONS endpoint for subtitle CORS preflight requests
 */
router.options('/subtitle/:resourceId/:subtitleId/:filename', (req, res) => {
    const corsHeaders = getSubtitleCorsHeaders(); // Use the same function!
    res.writeHead(200, corsHeaders);
    res.end();
});

// Performance monitoring for high concurrency user streaming
let userConnectionCount = 0;
let userRequestCount = 0;
let userErrorCount = 0;

// Request tracking middleware for high concurrency user streaming
const trackUserRequest = (req, res, next) => {
  userRequestCount++;
  userConnectionCount++;
  
  // Track request start time
  req.startTime = Date.now();
  
  // Track response completion
  res.on('finish', () => {
    userConnectionCount--;
    const duration = Date.now() - req.startTime;
    
    // Log slow requests
    if (duration > 5000) { // 5 seconds
      console.log(`🐌 User streaming: Slow request: ${req.method} ${req.url} - ${duration}ms`);
    }
    
    // Log high concurrency warnings
    if (userConnectionCount > 1500) {
      console.log(`⚠️ User streaming: High concurrency: ${userConnectionCount} active connections`);
    }
  });
  
  // Track errors
  res.on('error', () => {
    userErrorCount++;
  });
  
  next();
};

// Apply tracking to all user streaming routes
router.use(trackUserRequest);

// Memory pressure handling for high concurrency user streaming
const handleUserMemoryPressure = () => {
  const memUsage = process.memoryUsage();
  const heapUsagePercent = (memUsage.heapUsed / memUsage.heapTotal) * 100;
  
  if (heapUsagePercent > USER_STREAMING_CONFIG.BACKPRESSURE_THRESHOLD * 100) {
    console.log(`🚨 User streaming: Memory pressure detected: ${Math.round(heapUsagePercent)}% usage`);
    
    // Clear memory pool to free up space
    userContentPool.clear();
    console.log('🧹 User streaming: Memory pool cleared due to high pressure');
    
    // Force garbage collection if available
    if (global.gc) {
      global.gc();
      console.log('🗑️ User streaming: Forced garbage collection');
    }
    
    // Log memory status after cleanup
    const newMemUsage = process.memoryUsage();
    const newHeapUsagePercent = (newMemUsage.heapUsed / newMemUsage.heapTotal) * 100;
    console.log(`📊 User streaming: Memory after cleanup: ${Math.round(newHeapUsagePercent)}% usage`);
  }
};

// Monitor memory pressure every 30 seconds for user streaming
setInterval(handleUserMemoryPressure, 30000);

// Handle process signals for graceful shutdown
process.on('SIGTERM', () => {
  console.log('🔄 User streaming: Graceful shutdown initiated');
  userContentPool.clear();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('🔄 User streaming: Graceful shutdown initiated');
  userContentPool.clear();
  process.exit(0);
});

/**
 * Enhanced Health check for user streaming service with performance metrics
 */
router.get('/health', (req, res) => {
  const stats = {
    status: 'healthy',
    service: 'user-video-streaming',
    timestamp: new Date().toISOString(),
    performance: {
      activeConnections: userConnectionCount,
      totalRequests: userRequestCount,
      errors: userErrorCount,
      errorRate: userRequestCount > 0 ? (userErrorCount / userRequestCount * 100).toFixed(2) : 0
    },
    memory: {
      ...process.memoryUsage(),
      pool: userContentPool.getStats()
    },
    features: {
      trailerStreaming: true,
      videoStreaming: true,
      rangeRequests: true,
      hlsStreaming: true,
      mp4Streaming: true,
      optimizedChunking: true,
      caching: true,
      memoryPool: true,
      backpressureHandling: true,
      adaptiveQuality: true
    },
    config: {
      maxRangeSize: USER_STREAMING_CONFIG.MAX_RANGE_SIZE,
      chunkSizes: USER_STREAMING_CONFIG.CHUNK_SIZES,
      cacheDurations: USER_STREAMING_CONFIG.CACHE_DURATIONS,
      maxConcurrentStreams: USER_STREAMING_CONFIG.MAX_CONCURRENT_STREAMS,
      memoryPoolSize: USER_STREAMING_CONFIG.MEMORY_POOL_SIZE
    }
  };
  
  res.json(stats);
});

// Performance metrics endpoint for user streaming
router.get('/metrics', (req, res) => {
  const metrics = {
    timestamp: Date.now(),
    connections: userConnectionCount,
    requests: userRequestCount,
    errors: userErrorCount,
    memoryPool: userContentPool.getStats(),
    system: {
      memory: process.memoryUsage(),
      cpu: process.cpuUsage(),
      uptime: process.uptime()
    }
  };
  
  res.json(metrics);
});

// Memory pool cleanup endpoint for user streaming
router.post('/cleanup', (req, res) => {
  try {
    const beforeStats = userContentPool.getStats();
    userContentPool.clear();
    const afterStats = userContentPool.getStats();
    
    console.log('🧹 User streaming: Memory pool cleanup requested');
    
    res.json({
      success: true,
      message: 'Memory pool cleaned successfully',
      before: beforeStats,
      after: afterStats,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ User streaming: Memory pool cleanup failed:', error);
    res.status(500).json({
      success: false,
      error: 'Memory pool cleanup failed',
      details: error.message
    });
  }
});

export default router; 