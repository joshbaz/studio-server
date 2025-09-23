import { S3Client, GetObjectCommand, ListObjectsV2Command, HeadObjectCommand } from '@aws-sdk/client-s3';
import express from 'express';
import { PrismaClient } from '@prisma/client';
import { Agent as HttpsAgent } from 'https';
import dotenv from 'dotenv';
import { pipeline } from 'stream/promises';
import jwt from 'jsonwebtoken';
import { verifyToken } from '../middleware/verifyToken.js';
// Add rate limiting for abusive clients
import rateLimit from 'express-rate-limit';
import { s3RequestQueue, s3SubtitleRequestQueue, 
  getQueueMetrics, 
  checkQueueHealth  } from '@/services/request-queue.js';

  dotenv.config();

  // Connection state monitoring
const connectionStates = new Map();
const router = express.Router();
const prisma = new PrismaClient();

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

// Simplified connection pool configuration
const httpsAgent = new HttpsAgent({
    keepAlive: true,
    maxSockets: 1000, // Reduced from 5000 to prevent connection exhaustion
    maxFreeSockets: 250,
    timeout: 30000,
    scheduling: 'lifo', //Last-In-First-Out for better performance
    keepAliveMsecs: 1000,
  });

  // Initialize S3 client with proper configuration
const s3Client = new S3Client({
    endpoint: process.env.DO_REGIONALSPACESENDPOINT,
    region: process.env.DO_SPACESREGION,
    credentials: {
      accessKeyId: process.env.DO_SPACEACCESSKEY,
      secretAccessKey: process.env.DO_SPACESECRETKEY
    },
    maxAttempts: 3,
    retryMode: 'standard',
    requestHandler: {
      httpOptions: {
        agent: httpsAgent,
        timeout: 15000, // Increased timeout for better reliability
        connectTimeout: 8000,
        socketTimeout: 15000
      }
    },
    // TCP optimization
    tcpKeepAlive: true,
    connectionTimeout: 8000,
    // Disable the warning or increase timeout
    socketAcquisitionWarningTimeout: 30000, // 30 seconds instead of default
  });

 // Simplified streaming configuration
const STREAMING_CONFIG = {
    CHUNK_SIZES: {
      m3u8: 64 * 1024,
      ts: 512 * 1024,
      mp4: 256 * 1024,
      default: 128 * 1024
    },
    MAX_RANGE_SIZE: 2 * 1024 * 1024, // Reduced from 5MB to 2MB
    MIN_RANGE_SIZE: 1024,
    BUFFER_SIZE: 64 * 1024,
    HIGH_WATER_MARK: 128 * 1024,
    CACHE_DURATIONS: {
      m3u8: 300,
      ts: 86400,
      mp4: 2592000,
      default: 3600
    }
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
  
//   router.use('/video/:resourceId/:videoId/:filename', (req, res, next)=> {
//     res.setHeader('Access-Control-Allow-Origin', '*');
//     res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
//     res.setHeader('Access-Control-Allow-Headers', 'Range, Accept, Accept-Encoding, Content-Type');
//     res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Accept-Ranges, Content-Length');
//     res.setHeader('Access-Control-Max-Age', '86400');
  
//     if(req.method === 'OPTIONS') {
//       return res.status(200).end();
//     }
//     next();
//   })
  router.use('/video/:resourceId/:videoId/:filename', streamLimiter);
  router.use('/trailer/:resourceId/:videoId/:filename', streamLimiter);

  // Global error handler for streaming routes
router.use((error, req, res, next) => {
    if (req.url.includes('/video/') || req.url.includes('/trailer/')) {
      console.error('🚨 Global streaming error:', error);
  
      if (req.aborted) {
        console.log('⚠️ Error occurred after client disconnected');
        return;
      }
  
      if (!res.headersSent) {
        if (error.name === 'NoSuchKey') {
          res.status(404).json({ error: 'File not found' });
        } else if (error.name === 'AccessDenied') {
          res.status(403).json({ error: 'Access denied' });
        } else {
          res.status(500).json({ error: 'Streaming failed' });
        }
      }
    } else {
      next(error);
    }
  });

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

  // Add endpoint to monitor connections
router.get('/connections', (req, res) => {
    const now = Date.now();
    const connections = Array.from(connectionStates.entries()).map(([id, data]) => ({
      id,
      ...data,
      age: now - data.startTime
    }));
  
    res.json({
      total: connections.length,
      connections,
      timestamp: new Date().toISOString()
    });
  });

  // Request tracking middleware
router.use((req, res, next) => {
    if (!connectionTracker.acquire()) {
      return res.status(429).json({
        error: 'Too many concurrent requests',
        message: 'Please try again later'
      });
    }
  
    res.on('finish', () => {
      connectionTracker.release();
    });
  
    next();
  });

  // Health endpoint
router.get('/health', (req, res) => {
    res.json({
      status: 'healthy',
      connections: connectionTracker.getStats(),
      timestamp: new Date().toISOString()
    });
  });

  // Enhanced range request handler with better seeking support
const handleRangeRequest = (rangeHeader, fileSize, contentType, filename) => {
    if (!rangeHeader) return null;
  
    try {
      const parts = rangeHeader.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
  
      // Validate range
      if (isNaN(start) || isNaN(end) || start >= fileSize || end >= fileSize || start > end) {
        return null;
      }
  
       // Safely check filename (it might be undefined)
       const safeFilename = filename || '';
  
      // Optimize chunk sizes for different content types
       // For TS files, be more generous with range sizes to support proper buffering
      let maxChunkSize;
  
      if (safeFilename.includes('.ts')) {
        // Larger chunks for TS segments to reduce seeking overhead
        // maxChunkSize = 2 * 1024 * 1024; // 2MB for TS segments
        maxChunkSize = 4 * 1024 * 1024; // 4MB for TS segments (increased from 2MB)
      } else if (safeFilename.includes('.m3u8')) {
        // Full manifest for playlists
        // maxChunkSize = fileSize; // Return entire manifest
        return { start: 0, end: fileSize - 1, chunkSize: fileSize }; // Full manifest
      } else {
        maxChunkSize = 2 * 1024 * 1024; // 2MB default
      }
  
      const requestedSize = end - start + 1;
      // let finalEnd = end;
  
      // Don't chunk manifests - return full content
      // if (!filename.includes('.m3u8') && requestedSize > maxChunkSize) {
      //   finalEnd = start + maxChunkSize - 1;
      // }
  
      // Ensure minimum range size for efficient streaming
      // const minRangeSize = filename.includes('.ts') ? 64 * 1024 : 32 * 1024;
      // if (finalEnd - start + 1 < minRangeSize) {
      //   finalEnd = Math.min(start + minRangeSize - 1, fileSize - 1);
      // }
  
      // return {
      //   start,
      //   end: finalEnd,
      //   chunkSize: finalEnd - start + 1
      // };
  
       // Don't chunk if the requested size is reasonable
       if (requestedSize <= maxChunkSize) {
        return {
          start,
          end,
          chunkSize: requestedSize
        };
      }
  
      // Only chunk if significantly larger than max
      return {
        start,
        end: start + maxChunkSize - 1,
        chunkSize: maxChunkSize
      };
  
    } catch (error) {
      console.error('Range header parsing error:', error);
      return null;
    }
  };


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
    console.log(`🔐 User streaming: Token verified from query parameter for user: ${decoded.id}`);
    return { userId: decoded.id, isValid: true };
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
    console.log(`🔐 User streaming: Token verified from Authorization header for user: ${decoded.id}`);
    return { userId: decoded.id, isValid: true };
  } catch (error) {
    console.log(`❌ User streaming: Invalid token from Authorization header:`, error.message);
    return { userId: null, isValid: false };
  }
}

console.log(`❌ User streaming: No valid token found in query parameter or Authorization header`);
return { userId: null, isValid: false };
};

  // Get cache headers
const getCacheHeaders = (filename, rangeInfo) => {
    const baseHeaders = {
      'Accept-Ranges': 'bytes',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': 'Range, Accept, Accept-Encoding, Content-Type',
      'Access-Control-Expose-Headers': 'Content-Range, Accept-Ranges, Content-Length'
    };
  
    if (filename.includes('.m3u8')) {
     return {
        ...baseHeaders,
        'Cache-Control': 'no-cache, max-age=30', // Short cache for manifests
        'Expires': new Date(Date.now() + 30000).toUTCString()
      };
    } else if (filename.includes('.ts')) {
      // For TS files, cache aggressively but validate with ETag
      return {
        ...baseHeaders,
        'Cache-Control': 'public, max-age=31536000', // 1 year cache
        'ETag': `"${filename}-${rangeInfo ? rangeInfo.start : 'full'}"`
      };
    } 
  
    return {
      ...baseHeaders,
      'Cache-Control': 'public, max-age=3600'
    };
  };

  // Main streaming endpoint
router.get('/video/:resourceId/:videoId/:filename', async (req, res) => {
    let s3Response = null;
    try {
      const { resourceId, videoId, filename } = req.params;
      const rangeHeader = req.headers.range;
  
      console.log({
        success: true,
        metrics: getQueueMetrics(),
        health: checkQueueHealth(),
        timestamp: new Date().toISOString()
      })
  
      console.log(`Streaming request: ${resourceId}/${videoId}/${filename}`);
  
      // Handle client abort gracefully
      req.on('close', () => {
        console.log('⚠️ Client closed connection (likely seeking)');
        // Clean up any ongoing operations
      });
  
      // Get video info from database
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
          season: {
            select: {
              id: true,
              filmId: true
            }
          },
          episode: {
            select: {
              season: {
                select: {
                  id: true,
                  filmId: true
                }
              }
            }
          }
        }
      });
  
      if (!video) {
        return res.status(404).json({ error: 'Video not found' });
      }
  
      // Determine file path
      let filePath;
      let contentType;
      let actualResourcePath = resourceId;
  
      // Handle season/episode paths
      if (video.season?.filmId) {
        actualResourcePath = `${video.season.filmId}-${video.season.id}`;
      } else if (video.episode?.season?.filmId) {
        actualResourcePath = `${video.episode.season.filmId}-${video.episode.season.id}`;
      }
  
      const baseName = video.name.replace(/\.(m3u8|mp4)$/, '').replace(/^(SD_|HD_|FHD_|UHD_|master_)/, '');
  
      if (filename.includes('.m3u8')) {
        filePath = `${actualResourcePath}/hls_${video.resolution}_${baseName}/${filename}`;
        contentType = 'application/vnd.apple.mpegurl';
      } else if (filename.includes('.ts')) {
        filePath = `${actualResourcePath}/hls_${video.resolution}_${baseName}/${filename}`;
        contentType = 'video/mp2t';
      } else if (filename.includes('.mp4')) {
        filePath = `original_${baseName}.mp4`;
        contentType = 'video/mp4';
      } else {
        return res.status(400).json({ error: 'Unsupported file type' });
      }
  
      // Get file info from S3
      const headCommand = new HeadObjectCommand({
        Bucket: process.env.DO_SPACESBUCKET,
        Key: filePath
      });
  
      const headResponse = await s3RequestQueue.add(() => s3Client.send(headCommand));
      const fileSize = parseInt(headResponse.ContentLength);
  
      // Handle range request with filename for optimized chunk sizing
      const rangeInfo = handleRangeRequest(rangeHeader, fileSize, contentType, filename);
  
      // Set headers
      const headers = {
        'Content-Type': contentType,
        // 'Accept-Ranges': 'bytes',
        // 'Access-Control-Allow-Origin': '*',
        // 'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        // 'Access-Control-Allow-Headers': 'Range',
        ...getCacheHeaders(filename)
      };
  
      if (rangeInfo) {
        headers['Content-Range'] = `bytes ${rangeInfo.start}-${rangeInfo.end}/${fileSize}`;
        headers['Content-Length'] = rangeInfo.chunkSize;
        res.writeHead(206, headers);
      } else {
        headers['Content-Length'] = fileSize;
        res.writeHead(200, headers);
      }
  
      // Check if client already disconnected
      if (req.aborted) {
        console.log('⚠️ Request aborted before streaming');
        return;
      }
  
      // Stream from S3
      const getCommand = new GetObjectCommand({
        Bucket: process.env.DO_SPACESBUCKET,
        Key: filePath,
        ...(rangeInfo && { Range: `bytes=${rangeInfo.start}-${rangeInfo.end}` })
      });
  
      s3Response = await s3RequestQueue.add(()=>s3Client.send(getCommand));
  
  
      // Use our robust streaming function
      await streamWithErrorHandling(s3Response.Body, res, req);
  
    } catch (error) {
      console.error('Streaming error:', error);
      if (!req.aborted && !res.headersSent) {
        handleStreamError(error, res);
      } else {
        console.log('⚠️ Error occurred after client disconnected:', error.message);
      }
  
      // if (!res.headersSent) {
      //   if (error.name === 'NoSuchKey' || error.name === 'NotFound') {
      //     res.status(404).json({ error: 'File not found' });
      //   } else if (error.name === 'AccessDenied') {
      //     res.status(403).json({ error: 'Access denied' });
      //   } else {
      //     res.status(500).json({ error: 'Streaming failed' });
      //   }
      // }
    }
    finally {
      // Clean up S3 response
      if (s3Response && s3Response.Body && typeof s3Response.Body.destroy === 'function') {
        s3Response.Body.destroy();
      }
    }
  });

 // Trailer endpoint
router.get('/trailer/:resourceId/:videoId/:filename', async (req, res) => {
    try {
      const { resourceId, videoId, filename } = req.params;
      const rangeHeader = req.headers.range;
  
      console.log(`Trailer request: ${resourceId}/${videoId}/${filename}`);
  
      // Similar implementation as video endpoint but for trailers
      const trailerVideo = await prisma.video.findFirst({
        where: {
          id: videoId,
          isTrailer: true,
          OR: [
            { filmId: resourceId },
            { episodeId: resourceId },
            { seasonId: resourceId }
          ]
        },
        select: {
          name: true,
          resolution: true,
          season: {
            select: {
              id: true,
              filmId: true
            }
          }
        }
      });
  
      if (!trailerVideo) {
        return res.status(404).json({ error: 'Trailer not found' });
      }
  
      let filePath;
      let contentType;
      let actualResourcePath = resourceId;
  
      if (trailerVideo.season?.filmId) {
        actualResourcePath = `${trailerVideo.season.filmId}-${trailerVideo.season.id}`;
      }
  
      const baseName = trailerVideo.name.replace(/\.(m3u8|mp4)$/, '').replace(/^(HD_|trailer_)/, '');
  
      if (filename.includes('.m3u8')) {
        filePath = `${actualResourcePath}/hls_trailer/${filename}`;
        contentType = 'application/vnd.apple.mpegurl';
      } else if (filename.includes('.ts')) {
        filePath = `${actualResourcePath}/hls_trailer/${filename}`;
        contentType = 'video/mp2t';
      } else {
        return res.status(400).json({ error: 'Unsupported trailer file type' });
      }
  
      // Get file info and stream (similar to video endpoint)
      const headCommand = new HeadObjectCommand({
        Bucket: process.env.DO_SPACESBUCKET,
        Key: filePath
      });
  
      const headResponse = await s3RequestQueue.add(()=> s3Client.send(headCommand));
      const fileSize = parseInt(headResponse.ContentLength);
  
      const rangeInfo = handleRangeRequest(rangeHeader, fileSize, contentType, filename);
  
      const headers = {
        'Content-Type': contentType,
        'Accept-Ranges': 'bytes',
        'Access-Control-Allow-Origin': '*',
        ...getCacheHeaders(filename)
      };
  
      if (rangeInfo) {
        headers['Content-Range'] = `bytes ${rangeInfo.start}-${rangeInfo.end}/${fileSize}`;
        headers['Content-Length'] = rangeInfo.chunkSize;
        res.writeHead(206, headers);
      } else {
        headers['Content-Length'] = fileSize;
        res.writeHead(200, headers);
      }
  
      const getCommand = new GetObjectCommand({
        Bucket: process.env.DO_SPACESBUCKET,
        Key: filePath,
        ...(rangeInfo && { Range: `bytes=${rangeInfo.start}-${rangeInfo.end}` })
      });
  
      const response = await s3RequestQueue.add(()=>s3Client.send(getCommand));
      await pipeline(response.Body, res);
  
    } catch (error) {
      console.error('Trailer streaming error:', error);
  
      if (!res.headersSent) {
        res.status(500).json({ error: 'Trailer streaming failed' });
      }
    }
  });
  
  // URLs endpoint
router.get('/urls/:resourceId', verifyToken, async (req, res) => {
    try {
      const { resourceId } = req.params;

         // Verify token from query parameter or Authorization header
         const tokenInfo = verifyStreamingToken(req);
         if (!tokenInfo.isValid) {
           return res.status(401).json({ error: 'Unauthorized', message: 'Invalid or missing token' });
         }

         const userId = tokenInfo.userId; // Get user ID from auth middleware

      const baseUrl = `${req.protocol}://${req.get('host')}/api/v1/userStreaming`;

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
      
    }else {
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

          if (episode){
            resourceType = 'episode';
            resourceData = episode;

            // Check if episode's season is free through the access property
            isFree = episode.season.access === 'free';

             // Check if user has valid purchase for the season
             hasAccess = isFree || episode.season.purchase.length > 0;
          }  else {
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
      } else {

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
        return res.status(404).json({ error: 'No videos found' });
      }
  
      const response = {
        success: true,
        resourceId,
        baseUrl,
        hasTrailer: videos.some(v => v.isTrailer),
        hasRegularVideos: videos.some(v => !v.isTrailer),
        streamingConfig: {
          supportsRangeRequests: true,
          optimizedChunkSizes: STREAMING_CONFIG.CHUNK_SIZES
        }
      };
  
      // Separate trailers from regular videos
      const regularVideos = videos.filter(v => v.isTrailer !== true);
  
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
  
      // Handle regular video URLs if regular videos exist
         // Handle regular video URLs if regular videos exist (only if user has access)
      if (accessibleVideos.length > 0) {
        // Extract base video name from the first regular video
        const firstVideo = accessibleVideos[0];
        const baseVideoName = firstVideo.name.replace(/\.(m3u8|mp4)$/, ''); // Remove extension
        const cleanBaseName = baseVideoName.replace(/^(SD_|HD_|FHD_|UHD_|master_)/, '');
  
  
        // Find video ids for each resolution from regular videos only
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

        if (isFree){
             // Get all videos (not just accessible ones) for free content
             const allRegularVideos = regularVideos.filter(v => v.isTrailer !== true);

              // Generate URLs for ALL available resolutions
                  // Generate URLs for ALL available resolutions
        allRegularVideos.forEach(video => {
            if (video.resolution && video.resolution.toLowerCase() !== 'master') {
              const resKey = video.resolution.toLowerCase();
              const resLabel = video.resolution.toUpperCase();
              availableHlsUrls[resKey] = `${baseUrl}/video/${resourceId}/${video.id}/${resLabel}_${cleanBaseName}.m3u8`;
              console.log(`🆓 User streaming: Added ${resKey} resolution URL for video ${video.id} with name: ${video.name}`);
            }
          });

           // Also try to generate URLs using the getVideoIdByResolution function for consistency
           //this organises the order of the resolutions
           //commented out this section, if error comment this out
        //   ['sd', 'hd', 'fhd', 'uhd'].forEach(resKey => {
        //     const videoId = getVideoIdByResolution(resKey);
        //     if (videoId) {
        //       const resLabel = resKey.toUpperCase();
        //       if (!availableHlsUrls[resKey]) {
        //         availableHlsUrls[resKey] = `${baseUrl}/stream/video/${resourceId}/${videoId}/${resLabel}_${cleanBaseName}.m3u8`;
        //         console.log(`🆓 User streaming: Added ${resKey} resolution URL via getVideoIdByResolution for video ${videoId}`);
        //       }
        //     } else {
        //       console.log(`🆓 User streaming: No video found for ${resKey} resolution`);
        //     }
        //   });
        }else {
              // Only generate URLs for resolutions that exist in accessibleVideos (purchased ones)
        accessibleVideos.forEach(video => {
            if (video.resolution && video.resolution.toLowerCase() !== 'master') {
              const resKey = video.resolution.toLowerCase();
              const resLabel = video.resolution.toUpperCase();
              availableHlsUrls[resKey] = `${baseUrl}/video/${resourceId}/${video.id}/${resLabel}_${cleanBaseName}.m3u8`;
              console.log(`💰 User streaming: Generated URLs for ${Object.keys(availableHlsUrls).length - 1} purchased resolutions`);
              console.log(`💰 User streaming: Final availableHlsUrls:`, Object.keys(availableHlsUrls));
            }
          });
        }

        response.streamingUrls = {
           
            hls: availableHlsUrls
          };

        // response.streamingUrls = {
        //   mp4: `${baseUrl}/video/${resourceId}/${firstVideo.id}/original_${cleanBaseName}.mp4`,
        //   hls: {
        //     master: `${baseUrl}/video/${resourceId}/${getVideoIdByResolution('master')}/master_${cleanBaseName}.m3u8`,
        //     sd: `${baseUrl}/video/${resourceId}/${getVideoIdByResolution('sd')}/SD_${cleanBaseName}.m3u8`,
        //     hd: `${baseUrl}/video/${resourceId}/${getVideoIdByResolution('hd')}/HD_${cleanBaseName}.m3u8`,
        //     fhd: `${baseUrl}/video/${resourceId}/${getVideoIdByResolution('fhd')}/FHD_${cleanBaseName}.m3u8`,
        //     uhd: `${baseUrl}/video/${resourceId}/${getVideoIdByResolution('uhd')}/UHD_${cleanBaseName}.m3u8`
        //   }
        // };
  
        response.baseVideoName = cleanBaseName;
        response.videoIds = accessibleVideos.map(v => ({ id: v.id, resolution: v.resolution }));
  
        console.log(`🔗 User streaming: Generated regular video streaming URLs for ${resourceId}:`, response.streamingUrls);
      }
  
      // Add streaming configuration info
      response.streamingConfig = {
        supportsRangeRequests: true,
        optimizedChunkSizes: STREAMING_CONFIG.CHUNK_SIZES,
        cacheDurations: STREAMING_CONFIG.CACHE_DURATIONS,
        maxRangeSize: STREAMING_CONFIG.MAX_RANGE_SIZE
      };
  
      // Add backward compatibility flags
    //   response.hasTrailer = trailerVideos.length > 0;
      response.hasRegularVideos = regularVideos.length > 0;
  
      console.log(`📋 Final response summary:`, {
        resourceId,
        resourceType,
        totalVideos: videos.length,
        // trailers: trailerVideos.length,
        regularVideos: regularVideos.length,
        // hasTrailerUrls: !!response.trailerUrls,
        hasStreamingUrls: !!response.streamingUrls
      });
      res.json(response);
  
    } catch (error) {
      console.error('URLs endpoint error:', error);
      res.status(500).json({ error: 'Failed to generate URLs' });
    }
  });

  // CORS options endpoints
router.options('/video/:resourceId/:videoId/:filename', (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Range, Accept, Accept-Encoding, Content-Type'); // FIXED: Added missing headers
    res.setHeader('Access-Control-Max-Age', '86400');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Accept-Ranges, Content-Length'); 
    res.status(200).end();
  });
  
  router.options('/trailer/:resourceId/:videoId/:filename', (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Range, Accept, Accept-Encoding, Content-Type'); // FIXED
    res.setHeader('Access-Control-Max-Age', '86400');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Accept-Ranges, Content-Length'); // Add this
    res.status(200).end();
  });

  /** Get Subtitle files for a video resource */
router.get('/subtitles/:resourceId', async (req, res)=> {
    try{
      const { resourceId } = req.params;
      const baseUrl = `${req.protocol}://${req.get('host')}/api/v1/streaming`;
      console.log(`📝 Getting subtitle files for resource: ${resourceId}`);
  
      // Query database to get subtitle records for this resource
      const subtitleRecords = await prisma.subtitle.findMany({
        where: {
          resourceId: resourceId
        },
        select: {
          id: true,
          filename: true,
          language: true,
          label: true,
          s3Url: true,
          fileSize:true,
          createdAt:true
        },
        orderBy: {
          createdAt: 'asc'
        }
      })
  
      console.log(`📝 Found ${subtitleRecords.length} subtitle records in database for resource: ${resourceId}`);
  
      if(subtitleRecords.length === 0){
        return res.json({
          success: true,
          resourceId,
          subtitles: [],
          subtitleCount: 0,
          message: 'No subtitles found for this resource'
        })
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
  
  
      //response back to client for the subtitles
      res.json({
        success: true,
        resourceId,
        subtitles: availableSubtitles,
        subtitleCount: availableSubtitles.length,
        message: `Found ${availableSubtitles.length} subtitle(s) for this resource`
      });
     
    }catch(error){
      console.error(`❌ Error getting subtitle files:`, error);
      res.status(500).json({
        error: 'FAiled to get subtitle files',
        details: error.message
      })
    }
  });

 /** Get Subtitle files for a video resource */
router.get('/subtitles/:resourceId', async (req, res)=> {
    try{
      const { resourceId } = req.params;
      const baseUrl = `${req.protocol}://${req.get('host')}/api/v1/streaming`;
      console.log(`📝 Getting subtitle files for resource: ${resourceId}`);
  
      // Query database to get subtitle records for this resource
      const subtitleRecords = await prisma.subtitle.findMany({
        where: {
          resourceId: resourceId
        },
        select: {
          id: true,
          filename: true,
          language: true,
          label: true,
          s3Url: true,
          fileSize:true,
          createdAt:true
        },
        orderBy: {
          createdAt: 'asc'
        }
      })
  
      console.log(`📝 Found ${subtitleRecords.length} subtitle records in database for resource: ${resourceId}`);
  
      if(subtitleRecords.length === 0){
        return res.json({
          success: true,
          resourceId,
          subtitles: [],
          subtitleCount: 0,
          message: 'No subtitles found for this resource'
        })
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
  
  
      //response back to client for the subtitles
      res.json({
        success: true,
        resourceId,
        subtitles: availableSubtitles,
        subtitleCount: availableSubtitles.length,
        message: `Found ${availableSubtitles.length} subtitle(s) for this resource`
      });
     
    }catch(error){
      console.error(`❌ Error getting subtitle files:`, error);
      res.status(500).json({
        error: 'FAiled to get subtitle files',
        details: error.message
      })
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
 
  
  /** Stream subtitle files */
router.get('/subtitle/:resourceId/:subtitleId/:filename', async (req, res)=>{
    try{
      const { resourceId, subtitleId, filename } = req.params;
      const range = req.headers.range;
      console.log(`🎬 Subtitle streaming request: ${resourceId}/${subtitleId}/${filename}`);
  
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
          language:true
        }
       });
  
       if(!subtitle){
        return res.status(404).json({ error: 'Subtitle not found' });
       }
  
       console.log(`📋 Found subtitle: ${subtitle.filename} (${subtitle.language})`);
  
       const s3UrlParts = subtitle.s3Url.split('/');
       const bucketName = s3UrlParts[3]; // bucket-name
       const filePath = s3UrlParts.slice(3).join('/'); // file-path
  
       console.log(`📁 Extracted file path: ${filePath} from bucket: ${bucketName}`);
  
       // Optimized S3 request with connection pooling
       const headCommand = new GetObjectCommand({
        Bucket: process.env.DO_SPACESBUCKET,
        Key: filePath
       });
  
       const headResponse = await s3SubtitleRequestQueue.add(()=> s3Client.send(headCommand));
      const fileSize = parseInt(headResponse.ContentLength);
  
      console.log(`📊 File size: ${fileSize} bytes`);
  
       // Handle range requests with optimization
       const rangeInfo = handleRangeRequest(range, fileSize, 'text/vtt', filename); // Subtitle is always text/vtt
  
       if (rangeInfo){
        console.log(`📦 Streaming optimized chunk: ${rangeInfo.start}-${rangeInfo.end}/${fileSize} (${rangeInfo.chunkSize} bytes)`);
  
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
  
        const stream = await s3SubtitleRequestQueue.add(()=>s3Client.send(getCommand), "high");
  
        // Optimize the stream with proper buffering and connection reuse
        const optimizedStream = stream.Body;
        optimizedStream.on('error', (error) => {
          console.error('❌ Stream error:', error);
          if (!res.headersSent) {
            res.status(500).json({ error: 'Streaming failed' });
          }
        });
  
         // Pipe with optimized buffer settings and connection pooling
         optimizedStream.pipe(res, {
          highWaterMark: STREAMING_CONFIG.HIGH_WATER_MARK
        });
  
  
       } else {
        // Full file request with optimization
        console.log(`📦 Streaming full file: ${fileSize} bytes`);
  
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
  
        const stream = await s3SubtitleRequestQueue.add(()=> s3Client.send(getCommand), "high");
        
        // Optimize the stream with connection pooling
        const optimizedStream = stream.Body;
        optimizedStream.on('error', (error) => {
          console.error('❌ Stream error:', error);
          if (!res.headersSent) {
            res.status(500).json({ error: 'Streaming failed' });
          }
        });
  
        // Pipe with optimized buffer settings and connection reuse
        optimizedStream.pipe(res, {
          highWaterMark: STREAMING_CONFIG.HIGH_WATER_MARK
        });
      }
    }catch(error){
      console.error('❌ Subtitle streaming error:', error);
  
      if (error.name === 'NoSuchKey') {
        return res.status(404).json({ error: 'File not found' });
      }
      
      if (!res.headersSent) {
      res.status(500).json({ error: 'Subtitle streaming failed', details: error.message });
      }
    }
  })

  /**
 * OPTIONS endpoint for subtitle CORS preflight requests
 */
router.options('/subtitle/:resourceId/:subtitleId/:filename', (req, res) => {
    const corsHeaders = getSubtitleCorsHeaders(); // Use the same function!
    res.writeHead(200, corsHeaders);
    res.end();
  });
  // Add performance monitoring middleware
  router.use((req, res, next) => {
    req._startTime = Date.now();
    req._startHrtime = process.hrtime();
  
    res.on('finish', () => {
      const duration = Date.now() - req._startTime;
      const [seconds, nanoseconds] = process.hrtime(req._startHrtime);
      const hrtimeDuration = seconds * 1000 + nanoseconds / 1000000;
  
      if (duration > 2000) {
        console.log(`🐌 Slow request: ${req.method} ${req.url} - ${duration}ms (${hrtimeDuration.toFixed(2)}ms hrtime)`);
      }
    });
  
    next();
  });
  
  // Add middleware to track and log requests
  router.use((req, res, next) => {
    const startTime = Date.now();
    const requestId = Math.random().toString(36).substr(2, 9);
  
    console.log(`➡️ [${requestId}] ${req.method} ${req.url} - Started`);
  
    res.on('finish', () => {
      const duration = Date.now() - startTime;
      console.log(`✅ [${requestId}] ${req.method} ${req.url} - Completed in ${duration}ms`);
    });
  
    res.on('close', () => {
      const duration = Date.now() - startTime;
      console.log(`⚠️ [${requestId}] ${req.method} ${req.url} - Client closed connection after ${duration}ms`);
    });
  
    next();
  });
  
  // Add connection timeout with better handling
  router.use((req, res, next) => {
    // Set timeout for streaming requests (15 seconds - shorter for better seeking)
    if (req.url.includes('/video/') || req.url.includes('/trailer/')) {
      const timeout = 15000; // 15 seconds
  
      req.setTimeout(timeout, () => {
        console.log(`⏰ [${Math.random().toString(36).substr(2, 9)}] Request timeout after ${timeout}ms`);
        if (!res.headersSent) {
          res.status(408).json({ error: 'Request timeout' });
        }
      });
  
      // Handle timeout errors gracefully
      res.on('timeout', () => {
        console.log('⚠️ Response timeout occurred');
      });
    }
    next();
  });
  
  // Add queue monitoring endpoint
  router.get('/queue-metrics', (req, res) => {
    res.json({
      success: true,
      metrics: getQueueMetrics(),
      health: checkQueueHealth(),
      timestamp: new Date().toISOString()
    });
  });

  export default router;
  