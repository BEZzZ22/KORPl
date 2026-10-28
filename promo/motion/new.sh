#!/bin/bash
# new.sh <slug> "<title>": a film folder wired to ../common (fonts, lib, sets, kit)
set -e; cd "$(dirname "$0")"; mkdir -p $1/audio $1/docs
sed -e "s#<title>.*</title>#<title>$2</title>#; s#url(fonts/display.otf)#url(../common/fonts/display.otf)#; s#url(fonts/ui.otf)#url(../common/fonts/ui.otf)#" spirit3/index.html > $1/index.html
printf '{\n "title": "%s",\n "duration": 22,\n "formats": ["9x16"],\n "poster": 4\n}\n' "$2" > $1/film.json
