# Video Processing Jobs Management System

This system provides comprehensive management and monitoring capabilities for video transcoding jobs in the NyatiFilms studio server.

## 🚀 Features

### Backend (Node.js/Express)

- **Database Model**: `VideoProcessingJob` table to track all video processing jobs
- **Job Lifecycle Management**: Automatic status updates (waiting → active → completed/failed/cancelled)
- **Queue Integration**: Full integration with BullMQ for job processing
- **RESTful API**: Complete CRUD operations for job management

### Frontend (React/Material-UI)

- **Real-time Dashboard**: Live monitoring with auto-refresh every 30 seconds
- **Visual Statistics**: Overview cards showing job counts by status
- **Job Management**: Cancel, retry, and delete operations
- **Filtering**: Filter jobs by status and type
- **Bulk Operations**: Clear completed, failed, or all finished jobs

## 📊 API Endpoints

### GET `/api/v1/studio/processing-jobs`
- Get all video processing jobs with statistics
- Query parameters: `status`, `type`

### GET `/api/v1/studio/processing-jobs/:jobId`
- Get specific job details with queue information

### POST `/api/v1/studio/processing-jobs/:jobId/cancel`
- Cancel a waiting or active job

### POST `/api/v1/studio/processing-jobs/:jobId/retry`
- Retry a failed job

### DELETE `/api/v1/studio/processing-jobs/:jobId`
- Delete a finished job record

### POST `/api/v1/studio/processing-jobs/clear`
- Clear multiple jobs by status
- Body: `{ "status": "completed" | "failed" | "cancelled" | "all" }`

## 🗃️ Database Schema

```sql
model VideoProcessingJob {
  id           String   @id @default(auto()) @map("_id") @db.ObjectId
  jobId        String   @unique // BullMQ job ID
  queueName    String   // Queue name
  status       String   @default("waiting") // Job status
  progress     Int      @default(0) // Progress percentage
  
  // Resource details
  type         String   // "film" or "episode"
  resourceId   String   @db.ObjectId
  resourceName String   // Display name
  fileName     String   // Original filename
  
  // Job control
  canCancel    Boolean  @default(true)
  cancelledAt  DateTime?
  failedReason String?
  
  // Relationships
  film         film?    @relation(fields: [filmId], references: [id])
  episode      episode? @relation(fields: [episodeId], references: [id])
  season       season?  @relation(fields: [seasonId], references: [id])
  
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
}
```

## 🔄 Job Status Flow

```
waiting → active → completed
              ↓
            failed (can retry)
              ↓
           cancelled
```

## 🎯 Job Operations

### Cancel Job
- Available for: `waiting` and `active` jobs
- Removes job from BullMQ queue
- Updates status to `cancelled`
- Sets `canCancel` to `false`

### Retry Job
- Available for: `failed` jobs only
- Creates new BullMQ job with same parameters
- Resets status to `waiting`
- Generates new `jobId`

### Delete Job
- Available for: `completed`, `failed`, `cancelled` jobs
- Permanently removes job record from database
- Cannot be undone

## 🖥️ Frontend Components

### VideoJobsManager.jsx
- Main dashboard component
- Real-time job monitoring
- Interactive job management
- Material-UI design system

### Navigation Integration
- Added to Sidebar component
- Available at `/video-jobs` route
- Icon: `carbon--video`

## 📱 User Interface

### Dashboard Features
- **Statistics Cards**: Visual overview of job counts
- **Filter Controls**: Status and type filtering
- **Action Buttons**: Refresh, bulk clear operations
- **Jobs Table**: Detailed view with progress bars
- **Confirmation Dialogs**: Safe operation confirmations
- **Notifications**: Success/error feedback

### Job Table Columns
- Resource (Film/Episode name)
- Type (Movie/Episode)
- File Name
- Status (with icons)
- Progress (with progress bar)
- Created Date
- Actions (Cancel/Retry/Delete)

## 🔧 Implementation Details

### Queue Worker Integration
- Automatic job status updates in database
- Progress tracking during processing
- Error handling and failure reporting
- Status synchronization between BullMQ and database

### Error Handling
- Graceful degradation for missing queue jobs
- Database transaction safety
- User-friendly error messages
- Comprehensive logging

### Security
- All endpoints require authentication (`verifyToken`)
- Permission-based access control
- Input validation and sanitization

## 🚀 Usage

### Accessing the Dashboard
1. Navigate to `/video-jobs` in the studio application
2. View real-time job statistics and details
3. Use filters to find specific jobs
4. Perform actions on individual jobs or in bulk

### Managing Jobs
- **Monitor Progress**: Watch real-time progress updates
- **Cancel Jobs**: Stop unwanted or stuck jobs
- **Retry Failed Jobs**: Re-queue failed processing jobs
- **Clean Up**: Remove completed or failed job records

### API Integration
- Use the REST API for programmatic access
- Integrate with external monitoring systems
- Build custom dashboards or reports

## 📋 Job Information Tracking

Each job record includes:
- **Identification**: Unique job ID and BullMQ reference
- **Resource Context**: Film/episode details and relationships
- **Processing Details**: File name, type, and progress
- **Status Management**: Current state and capabilities
- **Timing Information**: Creation and completion timestamps
- **Error Details**: Failure reasons when applicable

## 🔮 Future Enhancements

- WebSocket integration for real-time updates
- Job priority management
- Detailed progress breakdowns by resolution
- Job scheduling and queuing strategies
- Performance metrics and analytics
- Email/SMS notifications for job completion
- Advanced filtering and search capabilities
- Export job reports and statistics

## 🛠️ Files Modified/Created

### Backend
- `prisma/schema.prisma` - Database model
- `src/api/v1/controllers/studio.js` - Job management endpoints
- `src/api/v1/routes/studioRouter.js` - API routes
- `src/services/queueWorkers.js` - Queue integration

### Frontend
- `studio/src/6-Views/Studio/studio-dashboard/8VideoJobs/VideoJobsManager.jsx` - Main component
- `studio/src/App.jsx` - Route configuration
- `studio/src/2-Components/Navigation/Sidebar.tsx` - Navigation links

### Additional
- `public/video-jobs-dashboard.html` - Standalone HTML dashboard
- `VIDEO_PROCESSING_JOBS_README.md` - This documentation

This system provides a complete solution for managing video processing workflows with both real-time monitoring and comprehensive control capabilities. 