#!/usr/bin/env bash
#
# 본인 머신에서 실행 (Docker 필요). 고정·격리된 emscripten 환경에서 WASM을 빌드해
# 산출물을 gif2webp 패키지에 떨군다.
#
#   pnpm build:wasm          # 레포 루트에서
#   # 또는: bash build/build-docker.sh
#
set -euo pipefail
cd "$(dirname "$0")"

# 핀 박은 버전 로드.
set -a; . ./versions.env; set +a

OUT_DIR="../packages/gif2webp/wasm"
LIC_DIR="../packages/gif2webp/licenses"
mkdir -p "$OUT_DIR" "$LIC_DIR"

echo ">> 빌드 (emsdk=$EMSDK_VERSION libwebp=$LIBWEBP_VERSION giflib=$GIFLIB_VERSION)"

# BuildKit --output 이 'export'(scratch) 스테이지를 폴더로 바로 추출.
DOCKER_BUILDKIT=1 docker build \
  --build-arg EMSDK_VERSION="$EMSDK_VERSION" \
  --build-arg LIBWEBP_VERSION="$LIBWEBP_VERSION" \
  --build-arg GIFLIB_VERSION="$GIFLIB_VERSION" \
  --target export \
  --output "type=local,dest=$OUT_DIR" \
  -f Dockerfile .

# 업스트림 라이선스 전문을 wasm 디렉터리에서 licenses/로 이동.
mv -f "$OUT_DIR"/libwebp-LICENSE.txt "$LIC_DIR"/ 2>/dev/null || true
mv -f "$OUT_DIR"/giflib-LICENSE.txt  "$LIC_DIR"/ 2>/dev/null || true

echo ">> $OUT_DIR 산출물:"
ls -la "$OUT_DIR"
echo ">> $LIC_DIR 업스트림 라이선스:"
ls -la "$LIC_DIR"
