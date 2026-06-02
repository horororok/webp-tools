#!/usr/bin/env bash
#
# 본인 머신에서 실행 (Docker 필요). 고정·격리된 emscripten 환경에서 img2webp WASM을
# 빌드해 산출물을 packages/img2webp 패키지에 떨군다.
#
#   pnpm build:wasm:img2webp     # 레포 루트에서
#   # 또는: bash build/build-docker-img2webp.sh
#
set -euo pipefail
cd "$(dirname "$0")"

# 핀 박은 버전 로드.
set -a; . ./versions.env; set +a

OUT_DIR="../packages/img2webp/wasm"
LIC_DIR="../packages/img2webp/licenses"
mkdir -p "$OUT_DIR" "$LIC_DIR"

echo ">> 빌드 (emsdk=$EMSDK_VERSION libwebp=$LIBWEBP_VERSION zlib=$ZLIB_VERSION libpng=$LIBPNG_VERSION libjpeg-turbo=$LIBJPEGTURBO_VERSION)"

# BuildKit --output 이 'export'(scratch) 스테이지를 폴더로 바로 추출.
# --progress=plain: RUN 단계 로그(코덱/libwebp 컴파일 진행 + PNG/JPEG find_package
#   결과)를 버퍼링 없이 그대로 흘려보낸다. 첫 빌드는 길어서 살아있는지 확인에 유용.
DOCKER_BUILDKIT=1 docker build \
  --progress=plain \
  --build-arg EMSDK_VERSION="$EMSDK_VERSION" \
  --build-arg LIBWEBP_VERSION="$LIBWEBP_VERSION" \
  --build-arg ZLIB_VERSION="$ZLIB_VERSION" \
  --build-arg LIBPNG_VERSION="$LIBPNG_VERSION" \
  --build-arg LIBJPEGTURBO_VERSION="$LIBJPEGTURBO_VERSION" \
  --target export \
  --output "type=local,dest=$OUT_DIR" \
  -f Dockerfile.img2webp .

# 업스트림 라이선스 전문을 wasm 디렉터리에서 licenses/로 이동.
for lic in libwebp libpng zlib libjpeg-turbo; do
  mv -f "$OUT_DIR/${lic}-LICENSE.txt" "$LIC_DIR/" 2>/dev/null || true
done

echo ">> $OUT_DIR 산출물:"
ls -la "$OUT_DIR"
echo ">> $LIC_DIR 업스트림 라이선스:"
ls -la "$LIC_DIR"

# --- versions.lock SHA 기록 -------------------------------------------------
# 편의상 자동 기록하되 "조용한 덮어쓰기"는 하지 않는다 — SHA가 바뀌면 의도된
# 업스트림/툴체인 변경인지 사람이 알아채야 하므로(CLAUDE.md 컨벤션). 따라서:
#   - lock 이 TODO(최초)  -> 자동으로 채움
#   - lock 과 일치          -> "재현 OK"만 출력
#   - lock 과 불일치        -> 덮어쓰지 않고 경고 (사람이 판단해 직접 갱신)
LOCK="versions.lock"
MJS="$OUT_DIR/img2webp.mjs"
if [ -f "$MJS" ] && [ -f "$LOCK" ]; then
  # macOS는 sha256sum이 없을 수 있어 shasum 우선.
  if command -v shasum >/dev/null 2>&1; then
    SHA=$(shasum -a 256 "$MJS" | awk '{print $1}')
  else
    SHA=$(sha256sum "$MJS" | awk '{print $1}')
  fi
  CUR=$(awk '/^img2webp\.mjs = /{print $3; exit}' "$LOCK")
  echo ">> img2webp.mjs SHA-256: $SHA"
  if [ "$CUR" = "TODO" ] || [ -z "$CUR" ]; then
    tmp=$(mktemp)
    awk -v sha="$SHA" '/^img2webp\.mjs = /{print "img2webp.mjs = " sha; next} {print}' \
      "$LOCK" > "$tmp" && mv "$tmp" "$LOCK"
    echo ">> versions.lock 에 최초 SHA 기록 완료."
  elif [ "$CUR" = "$SHA" ]; then
    echo ">> versions.lock 와 일치 — 재현 OK."
  else
    echo "!! 경고: versions.lock 의 SHA와 다릅니다 (자동 덮어쓰기 안 함)."
    echo "     lock:  $CUR"
    echo "     빌드:  $SHA"
    echo "     의도된 업스트림/툴체인 변경이면 versions.lock 을 직접 갱신 + semver 올릴 것."
  fi
fi
