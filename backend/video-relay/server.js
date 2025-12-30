const NodeMediaServer = require('node-media-server');

const config = {
    rtmp: {
        port: 1935,
        chunk_size: 60000,
        gop_cache: true,
        ping: 30,
        ping_timeout: 60
    },
    http: {
        port: 8000,
        mediaroot: './media', // Folder where fragments are stored
        allow_origin: '*'
    },
    // Transcoding is optional but good if camera sends weird encoding
    // Transcoding for HLS (Web Playback)
    trans: {
        ffmpeg: 'ffmpeg',
        tasks: [
            {
                app: 'live',
                hls: true,
                hlsFlags: '[hls_time=2:hls_list_size=3:hls_flags=delete_segments]',
                dash: true,
                dashFlags: '[f=dash:window_size=3:extra_window_size=5]'
            }
        ]
    }
};

var nms = new NodeMediaServer(config)
nms.run();

console.log('--- DAHUA RELAY SERVER STARTED ---');
console.log('1. RTMP Port: 1935 (Configure your camera to send here)');
console.log('2. HTTP Port: 8000 (Open browser here to view)');
console.log('----------------------------------');
