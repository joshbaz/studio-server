# Streaming Optimization for Upload Retry

## Overview

The upload retry functionality has been enhanced to automatically optimize videos for streaming when retrying failed uploads. This ensures that retried videos are properly configured for fast streaming from DigitalOcean Spaces CDN.

## What Happens During Retry

### 1. **Video Optimization Process**
When a failed upload job is retried, the system automatically:

- **Checks file existence** - Ensures the original video file is still available
- **Creates optimized version** - Generates a streaming-optimized copy using FFmpeg
- **Applies streaming optimizations**:
  - `-movflags +faststart+frag_keyframe+empty_moov` - Enables fast start for streaming
  - `-frag_duration 1000000` - 1-second fragments for better streaming
  - `-frag_size 1000000` - Optimized fragment size
  - `-avoid_negative_ts make_zero` - Fixes timestamp issues
  - `-fflags +genpts` - Generates presentation timestamps

### 2. **Enhanced Upload Process**
The optimized video is then uploaded with:

- **Better error handling** - Comprehensive error checking and cleanup
- **File size logging** - Tracks file size for monitoring
- **Automatic cleanup** - Removes temporary optimized files after upload
- **Status tracking** - Marks videos as optimized in the database

### 3. **Frontend Improvements**
The Upload Jobs Manager now shows:

- **Optimization status** - Visual indicator for optimized videos
- **Enhanced feedback** - Better success/error messages
- **Real-time updates** - Live progress tracking for retried uploads

## Technical Implementation

### Backend Changes

#### 1. **Enhanced Retry Function** (`retryUploadJob`)
```javascript
// Optimize video for streaming before retry
const optimizedFilePath = jobData.mergedFilePath.replace('.mp4', '_optimized.mp4');

await new Promise((resolve, reject) => {
    Ffmpeg(jobData.mergedFilePath)
        .outputOptions([
            '-c copy', // Copy without re-encoding
            '-movflags +faststart+frag_keyframe+empty_moov', // Streaming optimization
            '-frag_duration 1000000', // 1 second fragments
            '-frag_size 1000000',
            '-avoid_negative_ts make_zero',
            '-fflags +genpts',
        ])
        .output(optimizedFilePath)
        .on('end', resolve)
        .on('error', reject)
        .run();
});
```

#### 2. **Enhanced Upload Worker**
```javascript
// Check if file exists and get file size
if (!fs.existsSync(mergedFilePath)) {
    throw new Error(`Video file not found: ${mergedFilePath}`);
}

const fileStats = fs.statSync(mergedFilePath);
console.log(`File size: ${(fileStats.size / (1024 * 1024)).toFixed(2)} MB`);

// Clean up optimized file after successful upload
if (optimizedForStreaming && mergedFilePath.includes('_optimized.mp4')) {
    fs.unlinkSync(mergedFilePath);
}
```

#### 3. **Status Tracking**
```javascript
// Include optimization status in job data
const formattedJob = {
    // ... other fields
    optimizedForStreaming: jobData.optimizedForStreaming || false,
};
```

### Frontend Changes

#### 1. **Visual Indicators**
```javascript
{safeJob.optimizedForStreaming && (
    <Chip
        label="OPTIMIZED"
        size="small"
        color="success"
        variant="outlined"
        sx={{ ml: 1, fontSize: '0.7rem', height: '20px' }}
    />
)}
```

#### 2. **Enhanced Feedback**
```javascript
showSnackbar(`Upload job queued for retry${response.data.optimized ? ' with streaming optimization' : ''}`, 'success');
```

## Benefits

### 1. **Improved Streaming Performance**
- **Faster start times** - Videos begin playing immediately
- **Better buffering** - Optimized fragment sizes reduce buffering
- **CDN compatibility** - Properly formatted for DigitalOcean Spaces CDN

### 2. **Enhanced User Experience**
- **Visual feedback** - Users can see which videos are optimized
- **Better error handling** - Clear error messages and automatic cleanup
- **Real-time updates** - Live progress tracking during retry

### 3. **System Reliability**
- **Automatic cleanup** - Temporary files are removed automatically
- **Error recovery** - Graceful handling of optimization failures
- **Status tracking** - Complete audit trail of optimization status

## Usage

### Retrying a Failed Upload

1. **Navigate to Upload Jobs tab**
2. **Find failed upload job**
3. **Click retry button** (🔄 icon)
4. **Confirm retry action**
5. **Monitor progress** - Look for "OPTIMIZED" indicator
6. **Check completion** - Video will be optimized and uploaded

### Monitoring Optimization Status

- **Green "OPTIMIZED" chip** - Video has been optimized for streaming
- **File size logging** - Check console for file size information
- **Success messages** - "with streaming optimization" in success notifications

## Error Handling

### Optimization Failures
If video optimization fails:
- **Original file is used** - Upload continues with unoptimized video
- **Error is logged** - Detailed error information in console
- **User is notified** - Clear error message in frontend

### File Not Found
If original file is missing:
- **Error is returned** - "Original video file not found"
- **No retry attempted** - Prevents unnecessary processing

### Upload Failures
If upload fails after optimization:
- **Optimized file is cleaned up** - Temporary files are removed
- **Error is logged** - Complete error information
- **User is notified** - Clear failure message

## Performance Impact

### Optimization Time
- **Fast optimization** - Uses `-c copy` for speed
- **Minimal overhead** - Only adds streaming metadata
- **Parallel processing** - Multiple videos can be optimized simultaneously

### Storage Impact
- **Temporary files** - Optimized versions are temporary
- **Automatic cleanup** - Files are removed after upload
- **No permanent storage** - Only final uploaded videos are stored

## Future Enhancements

### Planned Improvements
1. **Quality-based optimization** - Different optimization levels based on video quality
2. **Batch optimization** - Optimize multiple failed uploads at once
3. **Progress tracking** - Real-time optimization progress
4. **Quality metrics** - Measure and report optimization effectiveness

### Configuration Options
1. **Optimization presets** - Different optimization levels
2. **Quality thresholds** - Skip optimization for already optimized videos
3. **Storage management** - Configurable cleanup policies

## Conclusion

The enhanced retry functionality with streaming optimization ensures that all retried uploads are properly configured for fast, reliable streaming from DigitalOcean Spaces. This improves both the technical performance and user experience of the video streaming platform. 