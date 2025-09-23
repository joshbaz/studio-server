class RequestQueue {
    constructor(maxConcurrent = 6, timeoutMs = 10000) {
        this.queue = [];
        this.processing = 0;
        this.maxConcurrent = maxConcurrent;
        this.isProcessing = false;
        this.timeoutMs = timeoutMs;

        // Circuit breaker properties
        this.failureCount = 0;
        this.successCount = 0;
        this.circuitState = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
        this.circuitOpenUntil = 0;
        this.totalRequests = 0;

          // Track active requests for cancellation
          this.activeRequests = new Map();
    }

    async add(requestFn, priority = 'normal', requestId = null) {
        this.totalRequests++;

         // Generate request ID if not provided
         const id = requestId || Date.now() + '-' + Math.random().toString(36).substr(2, 9);

        // Check circuit breaker
        // if (this.circuitState === 'OPEN') {
        //     if (Date.now() < this.circuitOpenUntil) {
        //         throw new Error('Circuit breaker open - service unavailable');
        //     }
        //     // Try to half-open the circuit
        //     this.circuitState = 'HALF_OPEN';
        // }
        return new Promise((resolve, reject) => {
            const priorityValue = priority === 'high' ? 1 : 2;
            console.log("these queued", this.queue.length)

            this.queue.push({
                id,
                requestFn, 
                resolve, 
                reject,
                priority: priorityValue,
                addedAt: Date.now()
            });
             // Sort by priority (lower number = higher priority)
             this.queue.sort((a, b) => a.priority - b.priority);
            this.process();
        });
    }

    _recordSuccess() {
        this.successCount++;
        this.failureCount = Math.max(0, this.failureCount - 1); // Decay failures
        
        if (this.circuitState === 'HALF_OPEN') {
            // Success in half-open state, close the circuit
            this.circuitState = 'CLOSED';
            this.failureCount = 0;
            console.log('✅ Circuit breaker closed');
        }
    }

    _recordFailure() {
        this.failureCount++;
        
        // Open circuit if too many failures
        if (this.failureCount >= 5 && this.circuitState === 'CLOSED') {
            this.circuitState = 'OPEN';
            this.circuitOpenUntil = Date.now() + 30000; // 30 second cooldown
            this.resetCircuit()
            console.log('🚨 Circuit breaker opened for 30 seconds');
        }
    }

    // Remove request from tracking
    removeRequest(id) {
        // Remove from active requests
        if (this.activeRequests.has(id)) {
            const { timeoutId } = this.activeRequests.get(id);
            clearTimeout(timeoutId);
            this.activeRequests.delete(id);
        }
        
        // Remove from queue
        const index = this.queue.findIndex(item => item.id === id);
        if (index !== -1) {
            const item = this.queue[index];
            clearTimeout(item.timeoutId);
            this.queue.splice(index, 1);
        }
    }

    // Cancel a specific request
    cancelRequest(id) {
        this.removeRequest(id);
        console.log(`🗑️ Cancelled request ${id}`);
    }

      // Cancel all requests (for cleanup)
      cancelAll() {
        // Clear all queued requests
        this.queue.forEach(item => {
            clearTimeout(item.timeoutId);
        });
        this.queue = [];
        
        // Note: Can't cancel currently processing requests, but we track them
        console.log(`🗑️ Cleared all queued requests (${this.queue.length} items)`);
    }

    async process() {
        if (this.processing >= this.maxConcurrent || this.queue.length === 0) return;

        this.processing++;
        const item = this.queue.shift();


         // Set timeout for the actual processing, not just queue time
         const timeoutId = setTimeout(() => {
            if (this.activeRequests.has(item.id)) {
                this.activeRequests.delete(item.id);
                this.processing--;
                item.reject(new Error('Request timeout'));
                this._recordFailure();
                this.process(); // Process next item
            }
        }, this.timeoutMs);

         // Track as active request
         this.activeRequests.set(item.id, {
            timeoutId,
            startTime: Date.now(),
        });



       try {
            const result = await item.requestFn();
            clearTimeout(timeoutId);
            this.activeRequests.delete(item.id);
            this.processing--;
            item.resolve(result);
            this._recordSuccess();
            this.process(); // Process next item
        } catch (error) {
            clearTimeout(timeoutId);
            this.activeRequests.delete(item.id);
            this.processing--;
            item.reject(error);
            this._recordFailure();
            this.process(); // Process next item
        } 
    }

    getStats() {
        const totalRequests = Math.max(this.totalRequests, 1); // Prevent division by zero
        return {
            queued: this.queue.length,
            processing: this.processing,
            activeRequests: this.activeRequests.size,
            maxConcurrent: this.maxConcurrent,
            failureRate: (this.failureCount / totalRequests) * 100, // ✅ Use totalRequests
            circuitState: this.circuitState,
            failureCount: this.failureCount,
            successCount: this.successCount,
            totalRequests: this.totalRequests
        };
    }

    // Reset circuit breaker (for testing/recovery)
    resetCircuit() {
        this.circuitState = 'CLOSED';
        this.failureCount = 0;
        this.circuitOpenUntil = 0;
    }
}

// Studio/internal queues (from before)
//create a shared queue instance
// Main video request queue - optimized for large media files
export const s3RequestQueue = new RequestQueue(12, 30000);

// Dedicated subtitle request queue - optimized for small text files
export const s3SubtitleRequestQueue = new RequestQueue(30, 20000); // Higher concurrency for subtitles

// User-facing queues (NEW - for user streaming)
export const s3UserRequestQueue = new RequestQueue(12, 30000); //25 concurrent

export const s3UserTrailerRequestQueue = new RequestQueue(12, 30000); //25 concurrent

export const s3UserSubtitleQueue = new RequestQueue(40, 20000); // 40 concurrent

// Optional: Combined queue monitoring
export const getQueueMetrics = () => ({
    video: s3RequestQueue.getStats(),
    subtitle: s3SubtitleRequestQueue.getStats(),
    timestamp: new Date().toISOString()
});

// Optional: Health check function
export const checkQueueHealth = () => {
    const videoStats = s3RequestQueue.getStats();
    const subtitleStats = s3SubtitleRequestQueue.getStats();

    return {
        video: {
            healthy: videoStats.processing < videoStats.maxConcurrent,
            ...videoStats
        },
        subtitle: {
            healthy: subtitleStats.processing < subtitleStats.maxConcurrent,
            ...subtitleStats
        },
        overall: videoStats.processing < videoStats.maxConcurrent &&
            subtitleStats.processing < subtitleStats.maxConcurrent
    };
};

// Enhanced monitoring with circuit breaker alerts
setInterval(() => {
    const videoStats = s3RequestQueue.getStats();
    const subtitleStats = s3SubtitleRequestQueue.getStats();
    
    if (videoStats.circuitState === 'OPEN') {
        console.log('⚠️ VIDEO CIRCUIT OPEN:', videoStats);
    }
    
    if (subtitleStats.circuitState === 'OPEN') {
        console.log('⚠️ SUBTITLE CIRCUIT OPEN:', subtitleStats);
    }
    
    if (videoStats.queued > 3 || subtitleStats.queued > 5) {
        console.log('📊 Queue Stats:', {
            video: videoStats,
            subtitle: subtitleStats,
            time: new Date().toISOString()
        });
    }
    
    // Log high failure rates
    if (videoStats.failureRate > 20 || subtitleStats.failureRate > 20) {
        console.log('🚨 High failure rate:', {
            videoFailure: `${videoStats.failureRate}%`,
            subtitleFailure: `${subtitleStats.failureRate}%`
        });
    }
}, 15000); // Check every 15 seconds


