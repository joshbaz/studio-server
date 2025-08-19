# Upload Tracking System for Video Jobs Manager

## Overview

The Video Jobs Manager now includes comprehensive upload tracking functionality that allows administrators to monitor, manage, and retry upload jobs to DigitalOcean Spaces. This system tracks all upload operations including HLS files, master playlists, and subtitle files.

## Features

### 🔄 **Dual Job Type Management**
- **Transcoding Jobs**: Traditional video processing jobs (splitting, transcoding, merging)
- **Upload Jobs**: All upload operations to DigitalOcean Spaces

### 📊 **Real-time Progress Tracking**
- Live progress updates via WebSocket connections
- Detailed progress information for each upload type
- Progress bars and status indicators

### 🎯 **Upload Job Types Tracked**
1. **HLS Upload Jobs** (`upload-hls-to-s3`)
   - Individual resolution HLS playlists and segments
   - Progress tracking per resolution
   - File count and upload status

2. **Master Playlist Upload Jobs** (`upload-master-playlist`)
   - Master HLS playlist files
   - Subtitle language information
   - Cross-resolution references

3. **Subtitle Upload Jobs** (`upload-subtitle-to-s3`)
   - WebVTT subtitle files
   - Language detection and labeling
   - Shared subtitle directory structure

### 🛠️ **Management Operations**
- **Retry Failed Uploads**: Automatically retry failed upload jobs
- **Cancel Active Uploads**: Stop uploads in progress
- **Clean Up Failed Jobs**: Remove temporary files and reset state
- **Sync Job Status**: Synchronize database with queue state
- **Fix Stuck Jobs**: Automatically detect and fix stuck upload jobs

## Database Schema

### UploadJob Model

```prisma
model UploadJob {
  id           String   @id @default(auto()) @map("_id") @db.ObjectId
  jobId        String   @unique // BullMQ job ID
  queueName    String?  // Queue name
  jobType      String   // Job type
  status       String   @default("waiting") // waiting, active, completed, failed, cancelled
  progress     Int      @default(0) // Progress percentage
  
  // Resource details
  resourceType String?  // "film", "episode", "season"
  resourceId   String   @db.ObjectId
  resourceName String?  // Resource title
  filename    String?  // Filename for upload
  
  // Upload-specific details
  uploadType   String?  // "hls", "master_playlist", "subtitle", "video"
  contentType  String?  // "video", "audio", "subtitle", "playlist"
  label        String?  // Resolution label (SD, HD, FHD, UHD)
  
  // File paths
  hlsDir              String? // HLS directory path
  masterPlaylistPath  String? // Master playlist file path
  subtitlePath        String? // Subtitle file path
  uploadPath          String? // Custom upload path
  
  // Metadata
  initialMetadata     Json?   // Original video metadata
  subtitleMetadata    Json?   // Subtitle file metadata
  subtitleLanguages   String[] // Available subtitle languages
  
  // S3 details
  bucketName   String?  // S3 bucket name
  clientId     String?  // Socket client ID
  
  // Job control
  canCancel    Boolean  @default(true)
  cancelledAt  DateTime?
  failedReason String?
  errorMessage String?
  
  // Relationships
  film         film?    @relation(fields: [filmId], references: [id])
  filmId       String?  @db.ObjectId
  episode      episode? @relation(fields: [episodeId], references: [id])
  episodeId    String?  @db.ObjectId
  season       season?  @relation(fields: [seasonId], references: [id])
  seasonId     String?  @db.ObjectId
  
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
}
```

## API Endpoints

### Upload Job Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/v1/studio/upload-jobs` | Get all upload jobs with filtering |
| `POST` | `/v1/studio/upload-jobs/:jobId/retry` | Retry a failed upload job |
| `POST` | `/v1/studio/upload-jobs/:jobId/cancel` | Cancel an active upload job |
| `DELETE` | `/v1/studio/upload-jobs/:jobId` | Delete a completed/failed upload job |
| `POST` | `/v1/studio/upload-jobs/clear` | Clear completed/failed upload jobs |
| `POST` | `/v1/studio/upload-jobs/:jobId/cleanup` | Clean up failed upload job files |
| `POST` | `/v1/studio/upload-jobs/:jobId/sync` | Sync job status with queue |
| `POST` | `/v1/studio/upload-jobs/fix-stuck` | Fix stuck upload jobs |

### Query Parameters

- `status`: Filter by job status (waiting, active, completed, failed, cancelled)
- `type`: Filter by resource type (film, episode)

### Clear Job Options

- `status: "completed"` - Clear only completed jobs
- `status: "failed"` - Clear only failed jobs  
- `status: "cancelled"` - Clear only cancelled jobs
- `status: "all"` - Clear all finished jobs

## Frontend Integration

### Job Type Toggle
The Video Jobs Manager now includes a toggle between:
- **Transcoding Jobs**: Traditional video processing
- **Upload Jobs**: DigitalOcean Spaces upload operations

### Statistics Dashboard
Real-time statistics for both job types:
- Total jobs count
- Waiting jobs
- Active jobs
- Completed jobs
- Failed jobs
- Cancelled jobs

### Progress Visualization
- **Transcoding Jobs**: Detailed progress for splitting, transcoding, merging, and uploading
- **Upload Jobs**: Upload progress with content type details

### Action Buttons
- **View Progress**: Expand detailed progress information
- **Retry**: Retry failed upload jobs
- **Cancel**: Stop active upload jobs
- **Clean Up**: Remove temporary files for failed jobs
- **Sync**: Synchronize job status with queue
- **Delete**: Remove completed/failed job records

## Queue Integration

### BullMQ Queues
- **`upload-hls-to-s3`**: HLS files and subtitle uploads
- **`upload-master-playlist`**: Master playlist uploads

### Job Creation
Upload jobs are automatically created when:
1. HLS files are queued for upload
2. Master playlists are queued for upload
3. Subtitle files are queued for upload

### Progress Updates
Real-time progress updates via WebSocket events:
- `uploadProgress`: Upload progress updates
- `JobCompleted`: Job completion notifications
- `JobFailed`: Job failure notifications
- `JobCancelled`: Job cancellation notifications

## Error Handling

### Automatic Retry
- Failed upload jobs can be retried with a single click
- Retry creates new queue jobs with fresh client IDs
- Maintains all original job metadata and file paths

### Cleanup Operations
- **Failed Jobs**: Automatic cleanup of temporary files
- **Stuck Jobs**: Detection and status synchronization
- **Cancelled Jobs**: Proper cleanup and state management

### Status Synchronization
- Database status automatically syncs with queue state
- Handles edge cases like stuck or orphaned jobs
- Provides accurate job status information

## Usage Examples

### Retry Failed Upload
```javascript
// Retry a failed HLS upload job
const response = await apiRequest.post(`/v1/studio/upload-jobs/${jobId}/retry`);
```

### Clear Completed Jobs
```javascript
// Clear all completed upload jobs
const response = await apiRequest.post('/v1/studio/upload-jobs/clear', { 
  status: 'completed' 
});
```

### Fix Stuck Jobs
```javascript
// Automatically fix stuck upload jobs
const response = await apiRequest.post('/v1/studio/upload-jobs/fix-stuck');
```

## Benefits

### 🚀 **Improved Reliability**
- Track upload failures and retry automatically
- Monitor upload progress in real-time
- Detect and fix stuck upload jobs

### 📈 **Better Visibility**
- Separate tracking for transcoding vs upload operations
- Detailed progress information for each upload type
- Real-time status updates and notifications

### 🛠️ **Enhanced Management**
- Retry failed uploads without manual intervention
- Clean up failed jobs and temporary files
- Synchronize job status across systems

### 🔍 **Debugging Support**
- Detailed error messages and failure reasons
- Job history and status tracking
- Queue state synchronization

## Configuration

### Environment Variables
No additional environment variables required - uses existing DigitalOcean Spaces and Redis configuration.

### Database Migration
Run Prisma migration to create the UploadJob table:
```bash
npx prisma migrate dev --name add_upload_jobs
npx prisma generate
```

### Queue Workers
Upload tracking is automatically integrated with existing queue workers:
- HLS upload worker
- Master playlist upload worker
- Subtitle upload worker

## Monitoring and Alerts

### Real-time Monitoring
- WebSocket-based progress updates
- Automatic job status synchronization
- Queue health monitoring

### Failure Detection
- Automatic detection of stuck jobs
- Failed job categorization and cleanup
- Error message logging and tracking

### Performance Metrics
- Upload job completion rates
- Average upload duration
- Failure rate tracking
- Queue backlog monitoring

## Troubleshooting

### Common Issues

1. **Upload Jobs Not Appearing**
   - Check queue worker status
   - Verify database connection
   - Check job creation logs

2. **Progress Updates Not Working**
   - Verify WebSocket connection
   - Check client ID matching
   - Verify progress event emission

3. **Retry Not Working**
   - Check job status (must be 'failed')
   - Verify queue worker availability
   - Check job metadata completeness

### Debug Information
The system includes comprehensive logging:
- Job creation and status updates
- Queue operation details
- Error messages and stack traces
- Progress update events

## Future Enhancements

### Planned Features
- **Bulk Operations**: Retry multiple failed jobs at once
- **Advanced Filtering**: Filter by upload type, content type, date range
- **Performance Analytics**: Upload speed and efficiency metrics
- **Automated Cleanup**: Scheduled cleanup of old job records
- **Email Notifications**: Job failure and completion alerts

### Integration Opportunities
- **Monitoring Dashboards**: Grafana/Prometheus integration
- **Alert Systems**: Slack/Discord notifications
- **Log Aggregation**: Centralized logging and analysis
- **Performance Optimization**: Upload queue optimization and load balancing

---

This upload tracking system provides comprehensive visibility and control over all upload operations, ensuring reliable delivery of video content to DigitalOcean Spaces with automatic error recovery and detailed progress monitoring.

