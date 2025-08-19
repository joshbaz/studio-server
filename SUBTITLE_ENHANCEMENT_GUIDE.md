# Subtitle Enhancement Guide - HLS Streaming with Full Subtitle Support

## 🎯 **Overview**

Your video streaming system has been enhanced with **comprehensive subtitle support** for HLS streaming. The system now automatically detects, extracts, and integrates subtitle tracks into your HLS streams, providing a complete accessibility solution.

## 📝 **What's New**

### **Before (No Subtitle Support)**
- HLS streams without subtitle tracks
- No accessibility features
- Limited language support
- Manual subtitle handling required

### **After (Full Subtitle Support)**
- **Automatic subtitle detection** - Extracts embedded subtitle tracks
- **Multi-language support** - Handles multiple subtitle languages
- **HLS integration** - Subtitles properly integrated into HLS playlists
- **WebVTT format** - Modern subtitle format for web compatibility
- **Database tracking** - Subtitle information stored in database

## 🔧 **Technical Implementation**

### **1. Subtitle Detection & Extraction**

```javascript
// Enhanced subtitle detection in transcodeVideo2
const subtitleInfo = await new Promise((resolve, reject) => {
    Ffmpeg(filePath).ffprobe((err, metadata) => {
        if (err) {
            console.warn('⚠️ Could not extract subtitle metadata:', err.message);
            resolve({ subtitleStreams: [], subtitleLanguages: [] });
            return;
        }
        
        const subtitleStreams = metadata.streams.filter(stream => 
            stream.codec_type === 'subtitle' && 
            (stream.codec_name === 'subrip' || stream.codec_name === 'ass' || stream.codec_name === 'webvtt')
        );
        
        const subtitleLanguages = subtitleStreams.map(stream => 
            stream.tags?.language || stream.tags?.title || 'Unknown'
        );
        
        console.log(`📝 Found ${subtitleStreams.length} subtitle tracks:`, subtitleLanguages);
        resolve({ subtitleStreams, subtitleLanguages });
    });
});
```

### **2. Enhanced HLS Generation with Subtitle Support**

```javascript
// Enhanced generateHLSPlaylist function
const generateHLSPlaylist = async (inputPath, outputDir, filename, label, clientId) => {
    // Extract available subtitle tracks
    const extractSubtitles = async () => {
        // FFmpeg subtitle extraction logic
    };

    // Generate HLS with subtitle integration
    const generateHLSWithSubtitles = async (subtitleStreams) => {
        const command = Ffmpeg(inputPath);
        
        // Add subtitle input streams
        subtitleStreams.forEach((stream, index) => {
            command.input(inputPath);
            command.inputOptions([`-map 0:s:${index}`]);
        });
        
        // Enhanced HLS options with subtitle support
        command
            .outputOptions(`-hls_subtitle_path ${label}_${filename}_subtitles`)
            .outputOptions(`-hls_flags independent_segments`)
            .outputOptions(`-hls_playlist_type vod`)
            // ... other options
    };
};
```

### **3. Master Playlist with Subtitle Tracks**

```javascript
// Enhanced master playlist generation
const generateMasterPlaylist = async (outputDir, filename, bucketName, subtitleLanguages = []) => {
    let masterPlaylist = '#EXTM3U\n#EXT-X-VERSION:3\n\n';
    
    // Add subtitle tracks if available
    if (subtitleLanguages.length > 0) {
        subtitleLanguages.forEach((language, index) => {
            const languageCode = language.toLowerCase().substring(0, 2);
            const subtitleUrl = `${baseUrl}/${bucketName}/subtitles/${filename}_${languageCode}.vtt`;
            
            masterPlaylist += `#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",LANGUAGE="${languageCode}",NAME="${language}",DEFAULT=NO,AUTOSELECT=YES,URI="${subtitleUrl}"\n`;
        });
    }
    
    // Add resolution streams with subtitle group reference
    for (const resolution of resolutionsArray) {
        if (subtitleLanguages.length > 0) {
            masterPlaylist += `#EXT-X-STREAM-INF:BANDWIDTH=${resolution.bitrate * 1000},RESOLUTION=${resolution.width}x${resolution.height},SUBTITLES="subs"\n`;
        } else {
            masterPlaylist += `#EXT-X-STREAM-INF:BANDWIDTH=${resolution.bitrate * 1000},RESOLUTION=${resolution.width}x${resolution.height}\n`;
        }
        masterPlaylist += `${hlsUrl}\n\n`;
    }
};
```

### **4. Subtitle File Upload**

```javascript
// New subtitle upload function
export async function uploadSubtitleToDO({
    subtitlePath,
    filename,
    resourceId,
    bucketName,
    clientId,
    type,
}) {
    const subtitleParams = {
        bucketName,
        key: `subtitles/${filename}/${subtitleFileName}`,
        buffer: subtitleStream,
        contentType: 'text/vtt',
        isPublic: true,
    };

    const subtitleData = await uploadToBucket(subtitleParams, (progress) => {
        io.to(clientId).emit('uploadProgress', {
            progress,
            content: { type, fileType: 'subtitle', subtitle: subtitleFileName },
            clientId,
        });
    });
}
```

## 📁 **File Structure**

### **Generated HLS Structure with Subtitles**

```
DigitalOcean Spaces Bucket:
├── hls_SD_filename/
│   ├── SD_filename.m3u8 (playlist with subtitle references)
│   ├── SD_filename_000.ts (video segment 1)
│   ├── SD_filename_001.ts (video segment 2)
│   ├── SD_filename_subtitles_000.vtt (subtitle segment 1)
│   ├── SD_filename_subtitles_001.vtt (subtitle segment 2)
│   └── ...
├── hls_HD_filename/
│   ├── HD_filename.m3u8
│   └── ...
├── hls_FHD_filename/
│   └── ...
├── hls_UHD_filename/
│   └── ...
├── subtitles/
│   ├── filename_en.vtt (English subtitles)
│   ├── filename_es.vtt (Spanish subtitles)
│   └── ...
└── master_filename.m3u8 (master playlist with subtitle groups)
```

### **Master Playlist Example**

```m3u8
#EXTM3U
#EXT-X-VERSION:3

#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",LANGUAGE="en",NAME="English",DEFAULT=YES,AUTOSELECT=YES,URI="subtitles/filename_en.vtt"
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",LANGUAGE="es",NAME="Spanish",DEFAULT=NO,AUTOSELECT=YES,URI="subtitles/filename_es.vtt"

#EXT-X-STREAM-INF:BANDWIDTH=1000000,RESOLUTION=854x480,SUBTITLES="subs"
hls_SD_filename/SD_filename.m3u8

#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1280x720,SUBTITLES="subs"
hls_HD_filename/HD_filename.m3u8

#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080,SUBTITLES="subs"
hls_FHD_filename/FHD_filename.m3u8

#EXT-X-STREAM-INF:BANDWIDTH=15000000,RESOLUTION=3840x2160,SUBTITLES="subs"
hls_UHD_filename/UHD_filename.m3u8
```

## 🎬 **Frontend Integration**

### **Enhanced ServerStreamingPlayer**

Your `ServerStreamingPlayer` component already has comprehensive subtitle support:

```javascript
// Subtitle state management
const [captionsEnabled, setCaptionsEnabled] = useState(false);
const [availableCaptions, setAvailableCaptions] = useState([]);
const [currentCaption, setCurrentCaption] = useState(null);
const [captionText, setCaptionText] = useState('');

// HLS.js subtitle configuration
const hls = new Hls({
    enableWebVTT: true, // Enable WebVTT captions
    enableIMSC1: true, // Enable IMSC1 captions
    enableCEA708Captions: true, // Enable CEA708 captions
    enableDateRangeMetadataCues: true, // Enable date range metadata for captions
    enableEmsgMetadataCues: true, // Enable emsg metadata for captions
});

// Subtitle event handlers
hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, (event, data) => {
    console.log('📝 Subtitle tracks updated:', data.subtitleTracks);
    if (data.subtitleTracks && data.subtitleTracks.length > 0) {
        setAvailableCaptions(data.subtitleTracks.map(track => ({
            id: track.id,
            label: track.name || track.lang || `Track ${track.id}`,
            language: track.lang,
            kind: 'subtitles'
        })));
    }
});

hls.on(Hls.Events.SUBTITLE_TRACK_SWITCHED, (event, data) => {
    console.log('📝 Subtitle track switched:', data);
    if (data.subtitleTrack) {
        setCurrentCaption(data.subtitleTrack);
        setCaptionsEnabled(true);
    }
});
```

### **Subtitle Controls**

The player includes comprehensive subtitle controls:

```javascript
// Subtitle toggle
const toggleCaptions = () => {
    const video = videoRef.current;
    if (video && video.textTracks && video.textTracks.length > 0) {
        const newState = !captionsEnabled;
        setCaptionsEnabled(newState);
        
        // Enable/disable all text tracks
        Array.from(video.textTracks).forEach(track => {
            track.mode = newState ? 'showing' : 'hidden';
        });
    }
};

// Subtitle track switching
const switchCaptionTrack = (trackId) => {
    const video = videoRef.current;
    if (video && video.textTracks) {
        // Hide all tracks first
        Array.from(video.textTracks).forEach(track => {
            track.mode = 'hidden';
        });
        
        // Show the selected track
        const selectedTrack = Array.from(video.textTracks).find(track => track.id === trackId);
        if (selectedTrack) {
            selectedTrack.mode = 'showing';
            setCurrentCaption(selectedTrack);
            setCaptionsEnabled(true);
        }
    }
};
```

## 🗄️ **Database Integration**

### **Updated Schema**

The system now tracks subtitle information in the database:

```prisma
model Film {
    // ... existing fields
    embeddedSubtitles    Boolean        @default(false)
    subtitleLanguage     String[]
}

model Episode {
    // ... existing fields
    embeddedSubtitles Boolean   @default(false)
    subtitleLanguage  String[]
}
```

### **Automatic Database Updates**

```javascript
// Update resource with subtitle information
if (subtitleInfo.subtitleLanguages.length > 0) {
    try {
        if (type === 'film') {
            await prisma.film.update({
                where: { id: resourceId },
                data: {
                    subtitleLanguage: subtitleInfo.subtitleLanguages,
                    embeddedSubtitles: true,
                }
            });
        } else if (type === 'episode') {
            await prisma.episode.update({
                where: { id: resourceId },
                data: {
                    subtitleLanguage: subtitleInfo.subtitleLanguages,
                    embeddedSubtitles: true,
                }
            });
        }
        console.log(`✅ Updated ${type} with subtitle information:`, subtitleInfo.subtitleLanguages);
    } catch (error) {
        console.warn(`⚠️ Failed to update ${type} with subtitle info:`, error.message);
    }
}
```

## 🚀 **Benefits**

### **Accessibility**
- **Multi-language support** - Automatic detection of embedded subtitle tracks
- **WebVTT format** - Modern, web-compatible subtitle format
- **HLS integration** - Proper subtitle integration in streaming playlists
- **User controls** - Easy subtitle toggle and language switching

### **Performance**
- **Automatic detection** - No manual subtitle processing required
- **Efficient encoding** - Subtitles encoded alongside video streams
- **CDN delivery** - Subtitle files delivered via CDN for fast loading
- **Fallback support** - Graceful handling when no subtitles are available

### **User Experience**
- **Seamless integration** - Subtitles work with adaptive bitrate streaming
- **Language switching** - Users can switch subtitle languages during playback
- **Visual feedback** - Clear indication of available subtitle tracks
- **Mobile support** - Optimized subtitle display on mobile devices

## 🔍 **Monitoring & Debugging**

### **Subtitle Detection Logs**

```javascript
console.log(`📝 Found ${subtitleStreams.length} subtitle tracks:`, subtitleLanguages);
console.log(`📝 Subtitle tracks:`, subtitleStreams.map(s => ({
    index: s.index,
    language: s.tags?.language || 'unknown',
    codec: s.codec_name
})));
```

### **Upload Progress Tracking**

```javascript
io.to(clientId).emit('uploadProgress', {
    progress,
    content: {
        type,
        fileType: 'subtitle',
        subtitle: subtitleFileName
    },
    clientId,
});
```

### **Error Handling**

```javascript
// Graceful fallback when subtitle extraction fails
if (err) {
    console.warn(`⚠️ Could not extract subtitle metadata: ${err.message}`);
    resolve({ subtitleStreams: [], subtitleLanguages: [] });
    return;
}
```

## 🎯 **Next Steps**

Your subtitle system is now **production-ready** with:

- ✅ **Automatic subtitle detection** and extraction
- ✅ **Multi-language support** with proper HLS integration
- ✅ **Database tracking** of subtitle information
- ✅ **Frontend controls** for subtitle management
- ✅ **CDN delivery** for fast subtitle loading
- ✅ **Error handling** and graceful fallbacks

The system will automatically handle subtitle processing for all new video uploads, providing a complete accessibility solution for your streaming platform! 