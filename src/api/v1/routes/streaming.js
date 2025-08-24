import express from 'express';
import fs from 'fs';
import path from 'path';
import { S3Client, GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { PrismaClient } from '@prisma/client';
import { Agent as HttpsAgent } from 'https';
import { Agent as HttpAgent } from 'http';
import dotenv from 'dotenv'

dotenv.config();
const router = express.Router();
const prisma = new PrismaClient();

// Configure HTTPS agent for high concurrency S3 operations
const httpsAgent = new HttpsAgent({
  keepAlive: false,
  keepAliveMsecs: 30000, // 30 seconds
  maxSockets: 20, // Increased from 200 to 500 for very high concurrency
  maxFreeSockets: 100, // Increased from 50 to 100
  timeout: 60000, // 60 seconds
  freeSocketTimeout: 30000, // 30 seconds
  socketAcquisitionWarningTimeout: 10000, // Increased to 10 seconds warning
});

// Configure global HTTP agent for high concurrency
const httpAgent = new HttpAgent({
  keepAlive: false,
  keepAliveMsecs: 30000, // 30 seconds
  maxSockets: 20, // Increased from default 50
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

// Streaming configuration constants
const STREAMING_CONFIG = {
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
 * Optimized range request handler
 */
const handleRangeRequest = (range, fileSize, contentType) => {
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
  const fileExtension = contentType.includes('m3u8') ? 'm3u8' : 
                       contentType.includes('mp2t') ? 'ts' : 
                       contentType.includes('mp4') ? 'mp4' : 'default';
  
  const optimalChunkSize = STREAMING_CONFIG.CHUNK_SIZES[fileExtension];
  const requestedSize = end - start + 1;
  
  // Limit range size for performance
  let finalEnd = end;
  if (requestedSize > STREAMING_CONFIG.MAX_RANGE_SIZE) {
    finalEnd = start + STREAMING_CONFIG.MAX_RANGE_SIZE - 1;
    console.log(`📦 Range size limited from ${requestedSize} to ${STREAMING_CONFIG.MAX_RANGE_SIZE} bytes`);
  }
  
  // Ensure minimum range size
  if (finalEnd - start + 1 < STREAMING_CONFIG.MIN_RANGE_SIZE) {
    finalEnd = Math.min(start + STREAMING_CONFIG.MIN_RANGE_SIZE - 1, fileSize - 1);
  }
  
  return {
    start,
    end: finalEnd,
    chunkSize: finalEnd - start + 1,
    isPartial: true
  };
};

/**
 * Get optimized cache headers based on content type
 */
const getCacheHeaders = (contentType, filename) => {
  const fileExtension = filename.includes('.m3u8') ? 'm3u8' : 
                       filename.includes('.ts') ? 'ts' : 
                       filename.includes('.mp4') ? 'mp4' : 'default';
  
  const cacheDuration = STREAMING_CONFIG.CACHE_DURATIONS[fileExtension];
  
  return {
    'Cache-Control': `public, max-age=${cacheDuration}, immutable`,
    'ETag': `"${filename}-${Date.now()}"`, // Simple ETag for caching
    'Last-Modified': new Date().toUTCString()
  };
};

/**
 * Stream trailer video files with optimized range support
 */
router.get('/trailer/:resourceId/:videoId/:filename', async (req, res) => {
  try {
    const { resourceId, videoId, filename } = req.params;
    const range = req.headers.range;
    
    console.log(`🎬 Trailer streaming request: ${resourceId}/${videoId}/${filename}`);
    console.log(`📡 Range: ${range}`);

    // Query database to get the specific trailer video by ID
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
        format: true,
        url: true,
        hlsUrl: true,
        // Include related data to determine if this is a season
        season: {
          select: {
            id: true,
            filmId: true
          }
        }
      }
    });

    if (!trailerVideo) {
      return res.status(404).json({ error: 'Trailer video not found' });
    }

    console.log(`📋 Found trailer video: ${trailerVideo.name} (${trailerVideo.resolution})`);

    // Determine the correct file path based on resource type
    let actualResourcePath = resourceId;
    
    // Special handling for seasons: use seriesId-seasonId format
    if (trailerVideo.season && trailerVideo.season.filmId) {
      actualResourcePath = `${trailerVideo.season.filmId}-${trailerVideo.season.id}`;
      console.log(`🎬 Season trailer detected - using path: ${actualResourcePath} (seriesId-seasonId format)`);
    }

    // Extract base trailer name from the video
    const baseTrailerName = trailerVideo.name.replace(/\.(m3u8|mp4)$/, ''); // Remove extension
    const cleanBaseName = baseTrailerName.replace(/^(HD_|trailer_)/, ''); // Remove HD_ and trailer_ prefixes
    
    console.log(`🎬 Base trailer name: ${cleanBaseName}`);
    console.log(`🎬 Trailer resolution: ${trailerVideo.resolution}`);
    console.log(`🎬 Using resource path: ${actualResourcePath}`);

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

    console.log(`📁 Final trailer file path: ${filePath}`);

    // Optimized S3 request with connection pooling
    const headCommand = new GetObjectCommand({
      Bucket: process.env.DO_SPACESBUCKET,
      Key: filePath
    });

    const headResponse = await s3Client.send(headCommand);
    const fileSize = parseInt(headResponse.ContentLength);
    
    console.log(`📊 Trailer file size: ${fileSize} bytes`);

    // Handle range requests with optimization
    const rangeInfo = handleRangeRequest(range, fileSize, contentType);
    
    if (rangeInfo) {
      console.log(`📦 Streaming optimized trailer chunk: ${rangeInfo.start}-${rangeInfo.end}/${fileSize} (${rangeInfo.chunkSize} bytes)`);

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
        ...getCacheHeaders(contentType, filename)
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
        console.error('❌ Trailer stream error:', error);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Trailer streaming failed' });
        }
      });

      // Pipe with optimized buffer settings and connection pooling
      optimizedStream.pipe(res, {
        highWaterMark: STREAMING_CONFIG.HIGH_WATER_MARK
      });

    } else {
      // Full file request with optimization
      console.log(`📦 Streaming full trailer file: ${fileSize} bytes`);

      const headers = {
        'Content-Length': fileSize,
        'Content-Type': contentType,
        'Accept-Ranges': 'bytes',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        'Access-Control-Allow-Headers': 'Range, Accept, Accept-Encoding, If-Range, If-Modified-Since, Content-Type',
        'Access-Control-Expose-Headers': 'Content-Range, Accept-Ranges, Content-Length',
        ...getCacheHeaders(contentType, filename)
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
        console.error('❌ Trailer stream error:', error);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Trailer streaming failed' });
        }
      });

      // Pipe with optimized buffer settings and connection reuse
      optimizedStream.pipe(res, {
        highWaterMark: STREAMING_CONFIG.HIGH_WATER_MARK
      });
    }

  } catch (error) {
    console.error('❌ Trailer streaming error:', error);
    
    if (error.name === 'NoSuchKey') {
      return res.status(404).json({ error: 'Trailer file not found' });
    }
    
    if (!res.headersSent) {
    res.status(500).json({ error: 'Trailer streaming failed', details: error.message });
    }
  }
});

/**
 * HEAD endpoint for trailer files
 */
router.head('/trailer/:resourceId/:videoId/:filename', async (req, res) => {
  try {
    const { resourceId, videoId, filename } = req.params;
    
    console.log(`🎬 HEAD request for trailer: ${resourceId}/${videoId}/${filename}`);

    // Query database to get the specific trailer video by ID
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

    if (!trailerVideo) {
      return res.status(404).json({ error: 'Trailer video not found' });
    }

    // Determine the correct file path based on resource type
    let actualResourcePath = resourceId;
    
    // Special handling for seasons: use seriesId-seasonId format
    if (trailerVideo.season && trailerVideo.season.filmId) {
      actualResourcePath = `${trailerVideo.season.filmId}-${trailerVideo.season.id}`;
      console.log(`🎬 Season trailer HEAD - using path: ${actualResourcePath} (seriesId-seasonId format)`);
    }

    // Extract base trailer name from the video
    const baseTrailerName = trailerVideo.name.replace(/\.(m3u8|mp4)$/, '');
    const cleanBaseName = baseTrailerName.replace(/^(HD_|trailer_)/, '');
    
    console.log(`🎬 Base trailer name extraction:`, {
      originalName: trailerVideo.name,
      baseTrailerName,
      cleanBaseName,
      resolution: trailerVideo.resolution,
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
      ...getCacheHeaders(contentType, filename)
    };

    res.writeHead(200, headers);
    res.end();

  } catch (error) {
    console.error('❌ HEAD request error for trailer:', error);
    
    if (error.name === 'NoSuchKey') {
      return res.status(404).json({ error: 'Trailer file not found' });
    }
    
    res.status(500).json({ error: 'HEAD request failed for trailer', details: error.message });
  }
});

/**
 * OPTIONS endpoint for trailer CORS preflight requests
 */
router.options('/trailer/:resourceId/:videoId/:filename', (req, res) => {
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
 * Stream video files with optimized range support
 */
router.get('/video/:resourceId/:videoId/:filename', async (req, res) => {
  try {
    const { resourceId, videoId, filename } = req.params;
    const range = req.headers.range;
    
    console.log(`🎬 Streaming request: ${resourceId}/${videoId}/${filename}`);
    console.log(`📡 Range: ${range}`);

    // Query database to get the specific video by ID
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
        film:true,
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

    console.log(`🎬 Video: `, video);

    if (!video) {
      return res.status(404).json({ error: 'Video not found' });
    }

    console.log(`📋 Found video: ${video.name} (${video.resolution})`);

    // Extract base video name from the video
    const baseVideoName = video.name.replace(/\.(m3u8|mp4)$/, ''); // Remove extension
    const cleanBaseName = baseVideoName.replace(/^(SD_|HD_|FHD_|UHD_|master_)/, ''); // Remove resolution and master prefixes
    
    console.log(`🎬 Base video name: ${cleanBaseName}`);
    console.log(`🎬 Video resolution: ${video.resolution}`);

    // Determine file path based on filename and video resolution
    let filePath;
    let contentType;
    
    console.log(`🔍 Analyzing filename: ${filename}`);

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
        console.log(`📋 Detected HLS playlist: ${filePath}`);
      
    } else if (filename.includes('.ts')) {
      // HLS segment file - use video resolution from database
      filePath = `${actualResourcePath}/hls_${video.resolution}_${cleanBaseName}/${filename}`;
      contentType = 'video/mp2t';
      console.log(`📋 Detected HLS segment: ${filePath}`);
    } else if (filename.includes('.mp4')) {
      // MP4 file - uploaded directly to bucket root
      filePath = `original_${cleanBaseName}.mp4`;
      contentType = 'video/mp4';
      console.log(`📋 Detected MP4 file: ${filePath}`);
    } else if (filename.includes('.vtt')) {
      // Subtitle file - from shared subtitle directory
      filePath = `${actualResourcePath}/subtitles/${cleanBaseName}/${filename}`;
      contentType = 'text/vtt';
      console.log(`📋 Detected subtitle file: ${filePath}`);
      console.log(`📝 Streaming subtitle file: ${filename} (${cleanBaseName})`);
    } else {
      return res.status(400).json({ error: 'Unsupported file type' });
    }

    console.log(`📁 File path: ${filePath}`);

    // Optimized S3 request with connection pooling
    const headCommand = new GetObjectCommand({
      Bucket: process.env.DO_SPACESBUCKET,
      Key: filePath
    });

    const headResponse = await s3Client.send(headCommand);
    const fileSize = parseInt(headResponse.ContentLength);
    
    console.log(`📊 File size: ${fileSize} bytes`);

    // Handle range requests with optimization
    const rangeInfo = handleRangeRequest(range, fileSize, contentType);
    
    if (rangeInfo) {
      console.log(`📦 Streaming optimized chunk: ${rangeInfo.start}-${rangeInfo.end}/${fileSize} (${rangeInfo.chunkSize} bytes)`);

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
        ...getCacheHeaders(contentType, filename)
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
        ...getCacheHeaders(contentType, filename)
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

  } catch (error) {
    console.error('❌ Streaming error:', error);
    
    if (error.name === 'NoSuchKey') {
      return res.status(404).json({ error: 'File not found' });
    }
    
    if (!res.headersSent) {
    res.status(500).json({ error: 'Streaming failed', details: error.message });
    }
  }
});

/**
 * HEAD endpoint for range request support
 */
router.head('/video/:resourceId/:videoId/:filename', async (req, res) => {
  try {
    const { resourceId, videoId, filename } = req.params;
    
    console.log(`🎬 HEAD request: ${resourceId}/${videoId}/${filename}`);

    // Query database to get the specific video by ID
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

    // Extract base video name from the video
    const baseVideoName = video.name.replace(/\.(m3u8|mp4)$/, '');
    const cleanBaseName = baseVideoName.replace(/^(SD_|HD_|FHD_|UHD_|master_)/, '');
    
    console.log(`🎬 Base video name extraction:`, {
      originalName: video.name,
      baseVideoName,
      cleanBaseName,
      resolution: video.resolution
    });
    
    // Determine file path and content type
    let filePath;
    let contentType;


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
      filePath = `${actualResourcePath}/hls_${video.resolution}_${cleanBaseName}/${filename}`;
      contentType = 'application/vnd.apple.mpegurl';
    } else if (filename.includes('.ts')) {
      filePath = `${actualResourcePath}/hls_${video.resolution}_${cleanBaseName}/${filename}`;
      contentType = 'video/mp2t';
    } else if (filename.includes('.mp4')) {
      filePath = `original_${cleanBaseName}.mp4`;
      contentType = 'video/mp4';
    } else if (filename.includes('.vtt')) {
      // Subtitle file - from shared subtitle directory
      filePath = `${actualResourcePath}/subtitles/${cleanBaseName}/${filename}`;
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
      ...getCacheHeaders(contentType, filename)
    };

    res.writeHead(200, headers);
    res.end();

  } catch (error) {
    console.error('❌ HEAD request error:', error);
    
    if (error.name === 'NoSuchKey') {
      return res.status(404).json({ error: 'File not found' });
    }
    
    res.status(500).json({ error: 'HEAD request failed', details: error.message });
  }
});

/**
 * OPTIONS endpoint for CORS preflight requests
 */
router.options('/video/:resourceId/:videoId/:filename', (req, res) => {
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
 * Get streaming URLs for a video resource
 */
router.get('/urls/:resourceId', async (req, res) => {
  try {
    const { resourceId } = req.params;
    const baseUrl = `${req.protocol}://${req.get('host')}/api/v1/streaming`;
    
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

    console.log(`📋 Found ${videos.length} videos for resource ${resourceId}:`, videos);

    // Separate trailers from regular videos
    const trailerVideos = videos.filter(v => v.isTrailer === true);
    const regularVideos = videos.filter(v => v.isTrailer !== true);
    
    console.log(`🎬 Found ${trailerVideos.length} trailer(s) and ${regularVideos.length} regular video(s)`);

    // Initialize response object
    const response = {
      success: true,
      resourceId,
      baseUrl,
      videoCount: videos.length,
      trailerCount: trailerVideos.length,
      regularVideoCount: regularVideos.length
    };

    // Handle trailer URLs if trailers exist
    if (trailerVideos.length > 0) {
      const trailerVideo = trailerVideos[0]; // Use the first trailer
      console.log(`🎬 Processing trailer video:`, trailerVideo);
      
      // Extract base trailer name for URL generation
      const baseTrailerName = trailerVideo.name.replace(/\.(m3u8|mp4)$/, '');
      const cleanTrailerName = baseTrailerName.replace(/^(HD_|trailer_)/, '');
      
      response.trailerUrls = {
        mp4: null, // Trailers don't have MP4 fallback
        hls: {
          // Use the dedicated trailer streaming endpoint
          trailer: `${baseUrl}/trailer/${resourceId}/${trailerVideo.id}/trailer_${cleanTrailerName}.m3u8`
        }
      };
      
      response.trailerInfo = {
        id: trailerVideo.id,
        name: trailerVideo.name,
        resolution: trailerVideo.resolution,
        format: trailerVideo.format,
        cleanName: cleanTrailerName
      };
      
      console.log(`🔗 Generated trailer streaming URLs for ${resourceId}:`, response.trailerUrls);
    }

    // Handle regular video URLs if regular videos exist
    if (regularVideos.length > 0) {
      // Extract base video name from the first regular video
      const firstVideo = regularVideos[0];
      const baseVideoName = firstVideo.name.replace(/\.(m3u8|mp4)$/, ''); // Remove extension
      const cleanBaseName = baseVideoName.replace(/^(SD_|HD_|FHD_|UHD_|master_)/, '');

      console.log(`🎬 Base video name for regular videos: ${cleanBaseName}`);

      // Find video ids for each resolution from regular videos only
      const getVideoIdByResolution = (resLabel) => {
        if (resLabel === 'master') {
          return firstVideo.id;
        }
        const found = regularVideos.find(
          v => v.resolution && v.resolution.toLowerCase() === resLabel
        );
        return found ? found.id : null;
      };

      // Generate dynamic streaming URLs for regular videos using the regular video endpoint
      response.streamingUrls = {
        mp4: `${baseUrl}/video/${resourceId}/${firstVideo.id}/original_${cleanBaseName}.mp4`,
        hls: {
          master: `${baseUrl}/video/${resourceId}/${getVideoIdByResolution('master')}/master_${cleanBaseName}.m3u8`,
          sd: `${baseUrl}/video/${resourceId}/${getVideoIdByResolution('sd')}/SD_${cleanBaseName}.m3u8`,
          hd: `${baseUrl}/video/${resourceId}/${getVideoIdByResolution('hd')}/HD_${cleanBaseName}.m3u8`,
          fhd: `${baseUrl}/video/${resourceId}/${getVideoIdByResolution('fhd')}/FHD_${cleanBaseName}.m3u8`,
          uhd: `${baseUrl}/video/${resourceId}/${getVideoIdByResolution('uhd')}/UHD_${cleanBaseName}.m3u8`
        }
      };

      response.baseVideoName = cleanBaseName;
      response.videoIds = regularVideos.map(v => ({ id: v.id, resolution: v.resolution }));

      console.log(`🔗 Generated regular video streaming URLs for ${resourceId}:`, response.streamingUrls);
    }

    // Add streaming configuration info
    response.streamingConfig = {
      supportsRangeRequests: true,
      optimizedChunkSizes: STREAMING_CONFIG.CHUNK_SIZES,
      cacheDurations: STREAMING_CONFIG.CACHE_DURATIONS,
      maxRangeSize: STREAMING_CONFIG.MAX_RANGE_SIZE
    };

    // Add backward compatibility flags
    response.hasTrailer = trailerVideos.length > 0;
    response.hasRegularVideos = regularVideos.length > 0;

    console.log(`📋 Final response summary:`, {
      resourceId,
      totalVideos: videos.length,
      trailers: trailerVideos.length,
      regularVideos: regularVideos.length,
      hasTrailerUrls: !!response.trailerUrls,
      hasStreamingUrls: !!response.streamingUrls
    });

    res.json(response);

  } catch (error) {
    console.error('❌ Error generating streaming URLs:', error);
    res.status(500).json({ error: 'Failed to generate streaming URLs', details: error.message });
  }
});

/**
 * Get subtitle files for a video resource
 */
router.get('/subtitles/:resourceId', async (req, res) => {
  try {
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
        label: true, // Include the label field
        s3Url: true,
        fileSize: true,
        createdAt: true
      },
      orderBy: {
        createdAt: 'asc'
      }
    });

    console.log(`📝 Found ${subtitleRecords.length} subtitle records in database for resource: ${resourceId}`);

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
          
    console.log(`📝 Returning ${availableSubtitles.length} subtitle files for ${resourceId}:`, 
      availableSubtitles.map(s => `${s.languageName} (${s.language})`));
          
          res.json({
            success: true,
            resourceId,
            subtitles: availableSubtitles,
            subtitleCount: availableSubtitles.length,
      message: `Found ${availableSubtitles.length} subtitle(s) for this resource`
    });

  } catch (error) {
    console.error('❌ Error getting subtitle files:', error);
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
    const range = req.headers.range;

    console.log(`🎬 Subtitle streaming request: ${resourceId}/${subtitleId}/${filename}`);
    console.log(`📡 Range: ${range}`);

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

    console.log(`📋 Found subtitle: ${subtitle.filename} (${subtitle.language})`);

    // Extract the file path from the S3 URL
    // S3 URL format: https://nyati-cdn.sfo3.digitaloceanspaces.com/bucket-name/file-path
    const s3UrlParts = subtitle.s3Url.split('/');
    const bucketName = s3UrlParts[3]; // bucket-name
    const filePath = s3UrlParts.slice(3).join('/'); // file-path

    console.log(`📁 Extracted file path: ${filePath} from bucket: ${bucketName}`);

    // Optimized S3 request with connection pooling
    const headCommand = new GetObjectCommand({
      Bucket: process.env.DO_SPACESBUCKET,
      Key: filePath
    });

    const headResponse = await s3Client.send(headCommand);
    const fileSize = parseInt(headResponse.ContentLength);
    
    console.log(`📊 File size: ${fileSize} bytes`);

    // Handle range requests with optimization
    const rangeInfo = handleRangeRequest(range, fileSize, 'text/vtt'); // Subtitle is always text/vtt
    
    if (rangeInfo) {
      console.log(`📦 Streaming optimized chunk: ${rangeInfo.start}-${rangeInfo.end}/${fileSize} (${rangeInfo.chunkSize} bytes)`);

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

      } catch (error) {
    console.error('❌ Subtitle streaming error:', error);
    
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
    
    console.log(`🎬 HEAD request for subtitle: ${resourceId}/${subtitleId}/${filename}`);

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

    console.log(`📁 Extracted file path: ${filePath} from bucket: ${bucketName}`);

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
    console.error('❌ HEAD request error for subtitle:', error);
    
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
 * Health check for streaming service
 */
router.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'video-streaming',
    timestamp: new Date().toISOString(),
    features: {
      rangeRequests: true,
      hlsStreaming: true,
      mp4Streaming: true,
      optimizedChunking: true,
      caching: true
    },
    config: {
      maxRangeSize: STREAMING_CONFIG.MAX_RANGE_SIZE,
      chunkSizes: STREAMING_CONFIG.CHUNK_SIZES,
      cacheDurations: STREAMING_CONFIG.CACHE_DURATIONS
    }
  });
});

export default router; 