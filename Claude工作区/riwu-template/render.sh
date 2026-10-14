#!/usr/bin/env bash
# 一条命令出片：
#   ./render.sh episodes/M006                    讲解式（完整讲解，约 45 秒）→ out/M006.mp4
#   ./render.sh episodes/M006 --format quiz      猜选式（约 20 秒）→ out/M006_quiz.mp4
#   ./render.sh episodes/M006 --format flash     快闪式（约 16 秒）→ out/M006_flash.mp4
#   ./render.sh episodes/M006 --format book      图鉴式（信息同讲解式，约 45 秒，翻书页）→ out/M006_book.mp4
#   可再加 --bgm 你的音乐.mp3
set -euo pipefail
cd "$(dirname "$0")"
# 优先用项目内安装的 remotion；没有就用全局的
RM="npx --no-install remotion"; [ -x node_modules/.bin/remotion ] || RM="remotion"
EP="${1:?用法: ./render.sh episodes/<编号> [--format reveal|quiz|flash|book] [--bgm 文件]}"; shift || true
FMT=""; REST=()
while [ $# -gt 0 ]; do
  case "$1" in --format) FMT="$2"; shift 2;; *) REST+=("$1"); shift;; esac
done
[ -z "$FMT" ] && FMT="$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]+'/episode.json')).get('format','reveal'))" "$EP")"
NAME="$(basename "$EP")"; [ "$FMT" != "reveal" ] && NAME="${NAME}_$FMT"
B="build/$NAME"
python3 scripts/prepare.py "$EP" --format "$FMT" --name "$NAME"
python3 scripts/audio.py "$B" ${REST[@]+"${REST[@]}"}
rm -rf build/bundle && $RM bundle src/index.ts --out-dir build/bundle --public-dir="$B/public" >/dev/null
mkdir -p out
$RM render build/bundle Film "out/$NAME.mp4" --props="$B/plan.json" --codec=h264 --crf=18 --pixel-format=yuv420p \
  --audio-codec=aac --audio-bitrate=192k --concurrency=2 --log=error
# 统一成 TV 色域 yuv420p + faststart，兼容各平台
ffmpeg -v error -y -i "out/$NAME.mp4" -vf "scale=out_range=tv:out_color_matrix=bt709,format=yuv420p" -c:v libx264 -crf 18 -preset medium \
  -color_range tv -colorspace bt709 -color_primaries bt709 -color_trc bt709 -c:a copy -movflags +faststart "out/$NAME.tmp.mp4" && mv "out/$NAME.tmp.mp4" "out/$NAME.mp4"
python3 scripts/qc.py "$EP" "out/$NAME.mp4" "$NAME"
