#!/bin/bash
# render_story.sh <film>: picture (30 fps), sfx, mix with the VO, delivery copy in project files (promo-stories)
set -e; cd "$(dirname "$0")"; export SK=${MOTION_REEL_SKILL:?путь к скиллу motion-reel}; F=$1
mkdir -p out/$F
node $SK/scripts/render.mjs --film $F --format 9x16 --fps 30 --video-only > out/$F.render.log 2>&1
node $SK/scripts/render.mjs --film $F --format 9x16 --hits >> out/$F.render.log 2>&1
node $SK/scripts/sfx.mjs $F >> out/$F.render.log 2>&1
node $SK/scripts/mix.mjs $F --vo-db 4 --music-db -3 >> out/$F.render.log 2>&1
mkdir -p /mnt/project-files/promo-stories
ffmpeg -y -loglevel error -i out/$F/final.mp4 -c:v libx264 -preset slow -b:v 5M -maxrate 6M -bufsize 12M -pix_fmt yuv420p -r 30 -c:a aac -b:a 192k -ar 48000 -movflags +faststart /mnt/project-files/promo-stories/$F.mp4
echo DONE $F
