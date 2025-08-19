// Test CORS configuration
async function testCORS() {
  const testUrl = 'https://nyati-cdn.sfo3.digitaloceanspaces.com/688bd160418629319f812414/hls_SD_lado_output_1080p_5mbps/SD_lado_output_1080p_5mbps.m3u8';
  
  try {
    console.log('🧪 Testing CORS configuration...');
    console.log('📡 Testing URL:', testUrl);
    
    const response = await fetch(testUrl, {
      method: 'HEAD',
      mode: 'cors'
    });
    
    console.log('✅ CORS test successful!');
    console.log('📋 Response headers:');
    
    for (const [key, value] of response.headers.entries()) {
      console.log(`  ${key}: ${value}`);
    }
    
  } catch (error) {
    console.error('❌ CORS test failed:', error.message);
  }
}

// Run test in browser console
if (typeof window !== 'undefined') {
  testCORS();
} else {
  console.log('Run this script in your browser console to test CORS');
} 