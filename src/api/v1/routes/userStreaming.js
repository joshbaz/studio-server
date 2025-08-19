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

dotenv.config();
const router = express.Router();
const prisma = new PrismaClient();

// Configure HTTPS agent for high concurrency S3 operations
const httpsAgent = new HttpsAgent({
  keepAlive: true,
  keepAliveMsecs: 30000, // 30 seconds
  maxSockets: 500, // Increased from 200 to 500 for very high concurrency
  maxFreeSockets: 100, // Increased from 50 to 100
  timeout: 60000, // 60 seconds
  freeSocketTimeout: 30000, // 30 seconds
  socketAcquisitionWarningTimeout: 10000, // Increased to 10 seconds warning
});

// Configure global HTTP agent for high concurrency
const httpAgent = new HttpAgent({
  keepAlive: true,
  keepAliveMsecs: 30000, // 30 seconds
  maxSockets: 500, // Increased from default 50
  maxFreeSockets: 100,
  timeout: 60000, // 60 seconds
  freeSocketTimeout: 30000, // 30 seconds
});

// Set global agents for all HTTP/HTTPS requests
global.httpsAgent = httpsAgent;
global.httpAgent = httpAgent;

// Initialize optimized S3 client for DigitalOcean Spaces with high concurrency support
const s3Client = new S3Client({
  endpoint: process.env.DO_REGIONALSPACESENDPOINT,
  region: process.env.DO_SPACESREGION,
  credentials: {
    accessKeyId: process.env.DO_SPACEACCESSKEY,
    secretAccessKey: process.env.DO_SPACESECRETKEY
  },
  maxAttempts: 3, // Retry failed requests
  retryMode: 'adaptive', // Adaptive retry strategy
  requestHandler: {
    httpOptions: {
      agent: httpsAgent,
      timeout: 60000, // 60 seconds timeout
    }
  }
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

// User streaming configuration constants
const USER_STREAMING_CONFIG = {
  // Optimal chunk sizes for different content types
  CHUNK_SIZES: {
    m3u8: 64 * 1024,    // 64KB for playlists (small, fast loading)
    ts: 1024 * 1024,    // 1MB for video segments (balance between speed and memory)
    mp4: 512 * 1024,    // 512KB for MP4 files (good for seeking)
    default: 256 * 1024 // 256KB default
  },
  
  // Cache durations (in seconds)
  CACHE_DURATIONS: {
    m3u8: 300,    // 5 minutes for playlists (frequently updated)
    ts: 86400,    // 24 hours for segments (rarely change)
    mp4: 604800,  // 7 days for MP4 files (static content)
    default: 3600 // 1 hour default
  },
  
  // Range request limits
  MAX_RANGE_SIZE: 10 * 1024 * 1024, // 10MB max range size
  MIN_RANGE_SIZE: 1024,              // 1KB min range size
  
  // Buffer settings
  BUFFER_SIZE: 64 * 1024, // 64KB buffer for streaming
  HIGH_WATER_MARK: 128 * 1024 // 128KB high water mark
};

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
const getUserCacheHeaders = (contentType, filename) => {
  const ext = path.extname(filename).toLowerCase();
  let cacheDuration = USER_STREAMING_CONFIG.CACHE_DURATIONS.default;
  
  if (ext === '.m3u8') cacheDuration = USER_STREAMING_CONFIG.CACHE_DURATIONS.m3u8;
  else if (ext === '.ts') cacheDuration = USER_STREAMING_CONFIG.CACHE_DURATIONS.ts;
  else if (ext === '.mp4') cacheDuration = USER_STREAMING_CONFIG.CACHE_DURATIONS.mp4;
  
  return {
    'Cache-Control': `public, max-age=${cacheDuration}`,
    'Expires': new Date(Date.now() + cacheDuration * 1000).toUTCString(),
    'Last-Modified': new Date().toUTCString()
  };
};

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
  try {
    const { resourceId, videoId, filename } = req.params;
   
    const range = req.headers.range;

    console.log(`🎬 User streaming: Trailer request: ${resourceId}/${videoId}/${filename} `);
    console.log(`📡 Range: ${range}`);

    // Trailers are freely accessible to everyone - no access restrictions needed
    console.log(`🎬 User streaming: Trailer access granted - trailers are free for all users`);

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
      console.log(`🎬 Season trailer detected - using path: ${actualResourcePath} (seriesId-seasonId format)`);
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

    // Get file info from S3
    const headCommand = new GetObjectCommand({
      Bucket: process.env.DO_SPACESBUCKET,
      Key: filePath
    });

    const headResponse = await s3Client.send(headCommand);
    const fileSize = parseInt(headResponse.ContentLength);
    
    console.log(`📊 User streaming: File size: ${fileSize} bytes`);

  

    // Handle range requests with optimization
    const rangeInfo = handleUserRangeRequest(range, fileSize, contentType);
    
    if (rangeInfo) {
      console.log(`📦 User streaming: Streaming optimized chunk: ${rangeInfo.start}-${rangeInfo.end}/${fileSize} (${rangeInfo.chunkSize} bytes)`);

      // Set optimized headers for range request
      const headers = {
        'Content-Range': `bytes ${rangeInfo.start}-${rangeInfo.end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': rangeInfo.chunkSize,
        'Content-Type': contentType,
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        'Access-Control-Allow-Headers': 'Range, Accept, Accept-Encoding, If-Range, If-Modified-Since, Content-Type',
        'Access-Control-Expose-Headers': 'Content-Range, Accept-Ranges, Content-Length',
        'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Max-Age': '86400',
        ...getUserCacheHeaders(contentType, filename)
      };

      res.writeHead(206, headers);

      // Stream the specific range with optimized buffer and connection pooling
      const getCommand = new GetObjectCommand({
        Bucket: process.env.DO_SPACESBUCKET,
        Key: filePath,
        Range: `bytes=${rangeInfo.start}-${rangeInfo.end}`
      });

      const stream = await s3Client.send(getCommand);
      
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
        'Content-Length': fileSize,
        'Content-Type': contentType,
        'Accept-Ranges': 'bytes',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        'Access-Control-Allow-Headers': 'Range, Accept, Accept-Encoding, If-Range, If-Modified-Since, Content-Type',
        'Access-Control-Expose-Headers': 'Content-Range, Accept-Ranges, Content-Length',
        'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Max-Age': '86400',
        ...getUserCacheHeaders(contentType, filename)
      };

      res.writeHead(200, headers);

      const getCommand = new GetObjectCommand({
        Bucket: process.env.DO_SPACESBUCKET,
        Key: filePath
      });

      const stream = await s3Client.send(getCommand);
      
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
  }
});

/**
 * HEAD endpoint for trailer files
 */
router.head('/stream/trailer/:resourceId/:videoId/:filename', async (req, res) => {
  try {
    const { resourceId, videoId, filename } = req.params;
    
    console.log(`🎬 User streaming: HEAD request for trailer: ${resourceId}/${videoId}/${filename}`);

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
        name: true,
        resolution: true,
        format: true,
        // Include related data to determine if this is a season
        season: {
          select: {
            id: true,
            filmId: true
          }
        }
      }
    });

    if (!video) {
      return res.status(404).json({ error: 'Trailer not found' });
    }

     // Determine the correct file path based on resource type
     let actualResourcePath = resourceId;

      // Special handling for seasons: use seriesId-seasonId format
    if (video.season && video.season.filmId) {
      actualResourcePath = `${video.season.filmId}-${video.season.id}`;
      console.log(`🎬 Season trailer HEAD - using path: ${actualResourcePath} (seriesId-seasonId format)`);
    }

     // Extract base trailer name from the video
     const baseTrailerName = video.name.replace(/\.(m3u8|mp4)$/, '');
     const cleanBaseName = baseTrailerName.replace(/^(HD_|trailer_)/, '');


     console.log(`🎬 Base trailer name extraction:`, {
      originalName: video.name,
      baseTrailerName,
      cleanBaseName,
      resolution: video.resolution,
      actualResourcePath
    });
    
    // Determine file path and content type for trailer
    let filePath;
    let contentType;

    if (filename.includes('.m3u8')) {
      filePath = `${actualResourcePath}/hls_trailer/${filename}`;
      contentType = 'application/vnd.apple.mpegurl';
    } else if (filename.includes('.ts')) {
      filePath = `${actualResourcePath}/hls_trailer/${filename}`;
      contentType = 'video/mp2t';
    } else {
      return res.status(400).json({ error: 'Unsupported trailer file type' });
    }

    console.log(`📁 User streaming: Extracted file path: ${filePath}`);

    // Get file info from S3
    const headCommand = new GetObjectCommand({
      Bucket: process.env.DO_SPACESBUCKET,
      Key: filePath
    });

    const headResponse = await s3Client.send(headCommand);
    const fileSize = parseInt(headResponse.ContentLength);
    
    

    // Set headers for HEAD request
    const headers = {
      'Content-Length': fileSize,
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': 'Range, Accept, Accept-Encoding, If-Range, If-Modified-Since, Content-Type',
      'Access-Control-Expose-Headers': 'Content-Range, Accept-Ranges, Content-Length',
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Max-Age': '86400',
      ...getUserCacheHeaders(contentType, filename)
    };

    res.writeHead(200, headers);
    res.end();

  } catch (error) {
    console.error('❌ User streaming HEAD request error for trailer:', error);
    
    if (error.name === 'NoSuchKey') {
      return res.status(404).json({ error: 'File not found' });
    }
    
    res.status(500).json({ error: 'HEAD request failed for trailer', details: error.message });
  }
});

/**
 * OPTIONS endpoint for trailer CORS preflight requests
 */
router.options('/stream/trailer/:resourceId/:videoId/:filename', (req, res) => {
  res.writeHead(200, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': 'Range, Accept, Accept-Encoding, If-Range, If-Modified-Since, Content-Type',
    'Access-Control-Expose-Headers': 'Content-Range, Accept-Ranges, Content-Length',
    'Access-Control-Max-Age': '86400' // Cache preflight for 24 hours
  });
  res.end();
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

    const headResponse = await s3Client.send(headCommand);
    const fileSize = parseInt(headResponse.ContentLength);
    
    console.log(`📊 User streaming: File size: ${fileSize} bytes`);

    // Handle range requests with optimization
    const rangeInfo = handleUserRangeRequest(range, fileSize, contentType);
    
    if (rangeInfo) {
      console.log(`📦 User streaming: Streaming optimized chunk: ${rangeInfo.start}-${rangeInfo.end}/${fileSize} (${rangeInfo.chunkSize} bytes)`);

      // Set optimized headers for range request
      const headers = {
        'Content-Range': `bytes ${rangeInfo.start}-${rangeInfo.end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': rangeInfo.chunkSize,
        'Content-Type': contentType,
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        'Access-Control-Allow-Headers': 'Range, Accept, Accept-Encoding, If-Range, If-Modified-Since, Content-Type',
        'Access-Control-Expose-Headers': 'Content-Range, Accept-Ranges, Content-Length',
        // Enhanced CORS headers for subtitle files
        ...(contentType === 'text/vtt' && {
          'Access-Control-Allow-Credentials': 'true',
          'Access-Control-Max-Age': '86400'
        }),
        ...getUserCacheHeaders(contentType, filename)
      };

      res.writeHead(206, headers);

      // Stream the specific range with optimized buffer and connection pooling
      const getCommand = new GetObjectCommand({
        Bucket: process.env.DO_SPACESBUCKET,
        Key: filePath,
        Range: `bytes=${rangeInfo.start}-${rangeInfo.end}`
      });

      const stream = await s3Client.send(getCommand);
      
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
        'Content-Length': fileSize,
        'Content-Type': contentType,
        'Accept-Ranges': 'bytes',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        'Access-Control-Allow-Headers': 'Range, Accept, Accept-Encoding, If-Range, If-Modified-Since, Content-Type',
        'Access-Control-Expose-Headers': 'Content-Range, Accept-Ranges, Content-Length',
        // Enhanced CORS headers for subtitle files
        ...(contentType === 'text/vtt' && {
          'Access-Control-Allow-Credentials': 'true',
          'Access-Control-Max-Age': '86400'
        }),
        ...getUserCacheHeaders(contentType, filename)
      };

      res.writeHead(200, headers);

      const getCommand = new GetObjectCommand({
        Bucket: process.env.DO_SPACESBUCKET,
        Key: filePath
      });

      const stream = await s3Client.send(getCommand);
      
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
    console.error('❌ User streaming video error:', error);
    
    if (error.name === 'NoSuchKey') {
      return res.status(404).json({ error: 'File not found' });
    }
    
    if (!res.headersSent) {
      res.status(500).json({ error: 'Video streaming failed', details: error.message });
    }
  }
});

/**
 * HEAD endpoint for regular video files
 */
router.head('/stream/video/:resourceId/:videoId/:filename', async (req, res) => {
  try {
    const { resourceId, videoId, filename } = req.params;
    
    // Verify token from query parameter or Authorization header
    const tokenInfo = verifyStreamingToken(req);
    if (!tokenInfo.isValid) {
      return res.status(401).json({ error: 'Unauthorized', message: 'Invalid or missing token' });
    }
    
    console.log(`🎬 User streaming: HEAD request for video: ${resourceId}/${videoId}/${filename}`);

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
        format: true
      }
    });

    if (!video) {
      return res.status(404).json({ error: 'Video not found' });
    }

    // Extract base video name from the video
    const baseVideoName = video.name.replace(/\.(m3u8|mp4)$/, '');
    const cleanBaseName = baseVideoName.replace(/^(SD_|HD_|FHD_|UHD_|master_)/, '');
    
    console.log(`🎬 User streaming: Base video name extraction:`, {
      originalName: video.name,
      baseVideoName,
      cleanBaseName,
      resolution: video.resolution
    });
    
    // Determine file path and content type
    let filePath;
    let contentType;
    
    if (filename.includes('.m3u8')) {
      filePath = `${resourceId}/hls_${video.resolution}_${cleanBaseName}/${filename}`;
      contentType = 'application/vnd.apple.mpegurl';
    } else if (filename.includes('.ts')) {
      filePath = `${resourceId}/hls_${video.resolution}_${cleanBaseName}/${filename}`;
      contentType = 'video/mp2t';
    } else if (filename.includes('.mp4')) {
      filePath = `original_${cleanBaseName}.mp4`;
      contentType = 'video/mp4';
    } else if (filename.includes('.vtt')) {
      // Subtitle file - from shared subtitle directory
      filePath = `${resourceId}/subtitles/${cleanBaseName}/${filename}`;
      contentType = 'text/vtt';
    } else {
      return res.status(400).json({ error: 'Unsupported file type' });
    }

    // Optimized S3 request with connection pooling
    const headCommand = new GetObjectCommand({
      Bucket: process.env.DO_SPACESBUCKET,
      Key: filePath
    });

    const headResponse = await s3Client.send(headCommand);
    const fileSize = parseInt(headResponse.ContentLength);
    
    // Set headers for HEAD request
    const headers = {
      'Content-Length': fileSize,
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': 'Range, Accept, Accept-Encoding, If-Range, If-Modified-Since, Content-Type',
      'Access-Control-Expose-Headers': 'Content-Range, Accept-Ranges, Content-Length',
      // Enhanced CORS headers for subtitle files
      ...(contentType === 'text/vtt' && {
        'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Max-Age': '86400'
      }),
      ...getUserCacheHeaders(contentType, filename)
    };

    res.writeHead(200, headers);
    res.end();

  } catch (error) {
    console.error('❌ User streaming HEAD request error for video:', error);
    
    if (error.name === 'NoSuchKey') {
      return res.status(404).json({ error: 'File not found' });
    }
    
    res.status(500).json({ error: 'HEAD request failed for video', details: error.message });
  }
});

/**
 * OPTIONS endpoint for regular video CORS preflight requests
 */
router.options('/stream/video/:resourceId/:videoId/:filename', (req, res) => {
  res.writeHead(200, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': 'Range, Accept, Accept-Encoding, If-Range, If-Modified-Since, Content-Type',
    'Access-Control-Expose-Headers': 'Content-Range, Accept-Ranges, Content-Length',
    'Access-Control-Max-Age': '86400' // Cache preflight for 24 hours
  });
  res.end();
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

    const headResponse = await s3Client.send(headCommand);
    const fileSize = parseInt(headResponse.ContentLength);
    
    console.log(`📊 User streaming: File size: ${fileSize} bytes`);

    // Handle range requests with optimization
    const rangeInfo = handleUserRangeRequest(range, fileSize, 'text/vtt'); // Subtitle is always text/vtt
    
    if (rangeInfo) {
      console.log(`📦 User streaming: Streaming optimized chunk: ${rangeInfo.start}-${rangeInfo.end}/${fileSize} (${rangeInfo.chunkSize} bytes)`);

      // Set optimized headers for range request
      const headers = {
        'Content-Range': `bytes ${rangeInfo.start}-${rangeInfo.end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': rangeInfo.chunkSize,
        'Content-Type': 'text/vtt',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        'Access-Control-Allow-Headers': 'Range, Accept, Accept-Encoding, If-Range, If-Modified-Since, Content-Type',
        'Access-Control-Expose-Headers': 'Content-Range, Accept-Ranges, Content-Length',
        // Enhanced CORS headers for subtitle files
        'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Max-Age': '86400'
      };

      res.writeHead(206, headers);

      // Stream the specific range with optimized buffer and connection pooling
      const getCommand = new GetObjectCommand({
        Bucket: process.env.DO_SPACESBUCKET,
        Key: filePath,
        Range: `bytes=${rangeInfo.start}-${rangeInfo.end}`
      });

      const stream = await s3Client.send(getCommand);
      
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
        'Content-Length': fileSize,
        'Content-Type': 'text/vtt',
        'Accept-Ranges': 'bytes',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        'Access-Control-Allow-Headers': 'Range, Accept, Accept-Encoding, If-Range, If-Modified-Since, Content-Type',
        'Access-Control-Expose-Headers': 'Content-Range, Accept-Ranges, Content-Length',
        // Enhanced CORS headers for subtitle files
        'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Max-Age': '86400'
      };

      res.writeHead(200, headers);

      const getCommand = new GetObjectCommand({
          Bucket: process.env.DO_SPACESBUCKET,
        Key: filePath
      });

      const stream = await s3Client.send(getCommand);
      
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
 * HEAD endpoint for subtitle files
 */
router.head('/subtitle/:resourceId/:subtitleId/:filename', async (req, res) => {
  try {
    const { resourceId, subtitleId, filename } = req.params;
    
    // Verify token from query parameter or Authorization header
    const tokenInfo = verifyStreamingToken(req);
    if (!tokenInfo.isValid) {
      return res.status(401).json({ error: 'Unauthorized', message: 'Invalid or missing token' });
    }
    
    console.log(`🎬 User streaming: HEAD request for subtitle: ${resourceId}/${subtitleId}/${filename}`);

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

    // Extract the file path from the S3 URL
    const s3UrlParts = subtitle.s3Url.split('/');
    const bucketName = s3UrlParts[3]; // bucket-name
    const filePath = s3UrlParts.slice(3).join('/'); // file-path

    console.log(`📁 User streaming: Extracted file path: ${filePath} from bucket: ${bucketName}`);

    // Optimized S3 request with connection pooling
    const headCommand = new GetObjectCommand({
      Bucket: bucketName,
      Key: filePath
    });

    const headResponse = await s3Client.send(headCommand);
    const fileSize = parseInt(headResponse.ContentLength);
    
    // Set headers for HEAD request
    const headers = {
      'Content-Length': fileSize,
      'Content-Type': 'text/vtt',
      'Accept-Ranges': 'bytes',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': 'Range, Accept, Accept-Encoding, If-Range, If-Modified-Since, Content-Type',
      'Access-Control-Expose-Headers': 'Content-Range, Accept-Ranges, Content-Length',
      // Enhanced CORS headers for subtitle files
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Max-Age': '86400'
    };

    res.writeHead(200, headers);
    res.end();

  } catch (error) {
    console.error('❌ User streaming HEAD request error for subtitle:', error);
    
    if (error.name === 'NoSuchKey') {
      return res.status(404).json({ error: 'File not found' });
    }
    
    res.status(500).json({ error: 'HEAD request failed for subtitle', details: error.message });
  }
});

/**
 * OPTIONS endpoint for subtitle CORS preflight requests
 */
router.options('/subtitle/:resourceId/:subtitleId/:filename', (req, res) => {
  res.writeHead(200, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': 'Range, Accept, Accept-Encoding, If-Range, If-Modified-Since, Content-Type',
    'Access-Control-Expose-Headers': 'Content-Range, Accept-Ranges, Content-Length',
    'Access-Control-Max-Age': '86400' // Cache preflight for 24 hours
  });
  res.end();
});

/**
 * Health check for user streaming service
 */
router.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'user-video-streaming',
    timestamp: new Date().toISOString(),
    features: {
      trailerStreaming: true,
      videoStreaming: true,
      rangeRequests: true,
      hlsStreaming: true,
      mp4Streaming: true,
      optimizedChunking: true,
      caching: true
    },
    config: {
      maxRangeSize: USER_STREAMING_CONFIG.MAX_RANGE_SIZE,
      chunkSizes: USER_STREAMING_CONFIG.CHUNK_SIZES,
      cacheDurations: USER_STREAMING_CONFIG.CACHE_DURATIONS
    }
  });
});

export default router; 