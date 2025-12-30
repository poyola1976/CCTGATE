@echo off
echo Starting Access Control Video Relay (NodeMediaServer)...
echo Verify that FFMPEG is in your system PATH for HLS transcoding.
cd backend\video-relay
npm start
pause
