#!/usr/bin/env bash
# Видеоразбор: реплей матча -> вывод парсера OpenDota. Нужен запущенный docker odota/parser на :5600.
#   tools/video/fetch-replay.sh <match_id> <outdir>   -> <outdir>/parsed.jsonl и <outdir>/match.json
# Коды: 0 — готово, 3 — у OpenDota нет ссылки на реплей или он не скачался, 5 — парсер не справился.
set -u
id="$1"; out="$2"
mkdir -p "$out"
curl -sf --max-time 60 "https://api.opendota.com/api/matches/$id" -o "$out/match.json" || exit 3
url=$(node -e 'try{console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).replay_url||"")}catch{console.log("")}' "$out/match.json")
[ -n "$url" ] || exit 3
curl -sf --max-time 300 "$url" -o "$out/replay.dem" || exit 3
# Valve пакует по-разному (bzip2, внутри бывает ещё zstd): снимаем слои по сигнатуре
for layer in 1 2 3; do
  magic=$(head -c 4 "$out/replay.dem" | od -An -tx1 | tr -d " \n")
  case "$magic" in
    425a68*) bunzip2 -c "$out/replay.dem" > "$out/replay.tmp" && mv "$out/replay.tmp" "$out/replay.dem" ;;
    28b52ffd) zstd -dqf "$out/replay.dem" -o "$out/replay.tmp" && mv "$out/replay.tmp" "$out/replay.dem" ;;
    *) break ;;
  esac
done
# как у самой OpenDota: поток через -T - (chunked)
curl -s --max-time 900 -X POST -T - -o "$out/parsed.jsonl" http://localhost:5600 < "$out/replay.dem" || exit 5
rm -f "$out/replay.dem"
grep -q '"type":"interval"' "$out/parsed.jsonl" || exit 5
