#!/usr/bin/env bash
# Глубокий разбор: скачать реплей матча и распаковать в .dem.
#   tools/deep/fetch-dem.sh <match_id> <файл.dem> [match.json]
# Коды: 0 — готово, 3 — у OpenDota нет ссылки на реплей или он не скачался.
set -u
id="$1"; out="$2"; meta="${3:-$out.match.json}"
curl -sf --max-time 60 "https://api.opendota.com/api/matches/$id" -o "$meta" || exit 3
url=$(node -e 'try{console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).replay_url||"")}catch{console.log("")}' "$meta")
[ -n "$url" ] || exit 3
curl -sf --max-time 300 "$url" -o "$out" || exit 3
# Valve пакует по-разному (bzip2, внутри бывает ещё zstd): снимаем слои по сигнатуре
for layer in 1 2 3; do
  magic=$(head -c 4 "$out" | od -An -tx1 | tr -d " \n")
  case "$magic" in
    425a68*) bunzip2 -c "$out" > "$out.tmp" && mv "$out.tmp" "$out" ;;
    28b52ffd) zstd -dqf "$out" -o "$out.tmp" && mv "$out.tmp" "$out" ;;
    *) break ;;
  esac
done
[ -s "$out" ]
