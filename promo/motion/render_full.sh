#!/bin/bash
# render_full.sh <film>: picture, sfx, mix, then a ≤24 MB delivery copy in project files
set -e; cd "$(dirname "$0")"; export SK=${MOTION_REEL_SKILL:?путь к скиллу motion-reel}; F=$1
node $SK/scripts/render.mjs --film $F --format 9x16 --fps 30 --video-only > out/$F.render.log 2>&1
node $SK/scripts/render.mjs --film $F --format 9x16 --hits >> out/$F.render.log 2>&1
node $SK/scripts/sfx.mjs $F >> out/$F.render.log 2>&1
node $SK/scripts/mix.mjs $F >> out/$F.render.log 2>&1
mkdir -p /mnt/project-files/youtube/motion
ffmpeg -y -loglevel error -i out/$F/final.mp4 -c:v libx264 -preset slow -b:v 6M -maxrate 7M -bufsize 12M -pix_fmt yuv420p -r 30 -c:a aac -b:a 192k -ar 48000 -movflags +faststart /mnt/project-files/youtube/motion/$F.mp4
ls -la /mnt/project-files/youtube/motion/$F.mp4 >> out/$F.render.log
echo DONE $F
