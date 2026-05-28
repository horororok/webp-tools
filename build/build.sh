#!/usr/bin/env bash
#
# emscripten/emsdk 컨테이너 "안에서" 실행됨 (Dockerfile이 호출).
# /out/gif2webp.mjs + /out/gif2webp.wasm 와 업스트림 라이선스 전문을 생성.
#
# 파이프라인:
#   1. giflib  -> libgif.a            (gif2webp가 GIF 디코딩에 giflib 필요)
#   2. libwebp -> 정적 라이브러리 + gif2webp 실행물, WASM ES 모듈로 링크
#
set -euo pipefail

: "${LIBWEBP_VERSION:?LIBWEBP_VERSION 누락}"
: "${GIFLIB_VERSION:?GIFLIB_VERSION 누락}"

SRC=/work/src
OUT=/out
GIF_PREFIX=/work/giflib-install
mkdir -p "$SRC" "$OUT" "$GIF_PREFIX/include" "$GIF_PREFIX/lib"
cd "$SRC"

############################################################
# 1) giflib -> libgif.a (emscripten 정적 아카이브)
############################################################
echo ">> [1/2] giflib ${GIFLIB_VERSION} 다운로드 + 빌드"
curl -fsSL -o giflib.tar.gz \
  "https://downloads.sourceforge.net/giflib/giflib-${GIFLIB_VERSION}.tar.gz"
# TODO(재현성): 한 번 돌려보고 타르볼을 신뢰하게 되면 핀 고정:
#   echo "<sha256>  giflib.tar.gz" | sha256sum -c -
tar xf giflib.tar.gz
cd "giflib-${GIFLIB_VERSION}"

# giflib는 크로스컴파일용이 아닌 평범한 Makefile을 제공하므로, 코어 소스를 바로
# wasm 오브젝트로 컴파일해 아카이브한다. 이 세트가 표준 libgif(디코더 + 할당 +
# 해싱)이며 gif2webp에 충분하다.
GIF_SRCS="dgif_lib.c egif_lib.c gifalloc.c gif_err.c gif_hash.c openbsd-reallocarray.c quantize.c"
emcc -O3 -I. -c ${GIF_SRCS}
emar rcs libgif.a ./*.o
cp gif_lib.h "$GIF_PREFIX/include/"
cp libgif.a  "$GIF_PREFIX/lib/"
# THIRD_PARTY 고지용 라이선스 전문 (giflib: MIT).
cp COPYING "$OUT/giflib-LICENSE.txt" 2>/dev/null || true
cd "$SRC"

############################################################
# 2) libwebp + gif2webp (emscripten이 구동하는 CMake)
############################################################
echo ">> [2/2] libwebp ${LIBWEBP_VERSION} (gif2webp) 다운로드 + 빌드"
curl -fsSL -o libwebp.tar.gz \
  "https://github.com/webmproject/libwebp/archive/refs/tags/v${LIBWEBP_VERSION}.tar.gz"
# TODO(재현성): 위와 동일하게 확인 후 SHA-256 핀 고정.
tar xf libwebp.tar.gz
cd "libwebp-${LIBWEBP_VERSION}"
cp COPYING "$OUT/libwebp-LICENSE.txt" 2>/dev/null || true

# gif2webp가 유일하게 빌드되는 실행물(다른 도구 전부 OFF)이므로, 전역 EXE 링커
# 플래그가 이 하나에만 적용된다. callMain + FS를 노출하고 자동 실행을 끄면 JS
# 래퍼가 구동: input.gif 쓰기 -> callMain(args) -> 가상 FS에서 output.webp 읽기.
#
# SINGLE_FILE=1: wasm을 mjs glue에 base64로 인라인. 소비자가 별도 .wasm 파일을
#   호스팅/번들링 신경 안 써도 됨. ~33% 사이즈 오버헤드(gzip 후 거의 무시 가능)
#   대신 Vite/Webpack/Next 등 어느 번들러에서도 단일 .mjs import만으로 동작.
# pthread는 의도적으로 비활성 (-DWEBP_USE_THREAD=OFF). gif2webp는 짧은 단일
#   변환이라 멀티스레드 이득보다 배포 비용(COOP/COEP, SharedArrayBuffer, Worker
#   파일 별도 호스팅)이 훨씬 큼.
# ENVIRONMENT=web,worker (node 제외): node를 넣으면 glue에 import("module")이
#   박혀 소비자 Vite 빌드에서 "Module externalized" 경고가 나고 optimizeDeps.exclude
#   를 강요받음. 브라우저 전용 라이브러리라 node 제거. worker는 남겨 소비자가
#   Web Worker 안에서 변환을 돌릴 수 있게 함. (트레이드오프: Node 스모크 불가 →
#   수동 QA는 examples/playground로)
EM_LINK="-O3 \
  -sMODULARIZE=1 \
  -sEXPORT_ES6=1 \
  -sEXPORT_NAME=Gif2Webp \
  -sEXPORTED_RUNTIME_METHODS=callMain,FS \
  -sINVOKE_RUN=0 \
  -sEXIT_RUNTIME=0 \
  -sALLOW_MEMORY_GROWTH=1 \
  -sFORCE_FILESYSTEM=1 \
  -sSINGLE_FILE=1 \
  -sENVIRONMENT=web,worker"

emcmake cmake -B build -S . \
  -DCMAKE_BUILD_TYPE=Release \
  -DBUILD_SHARED_LIBS=OFF \
  -DWEBP_BUILD_GIF2WEBP=ON \
  -DWEBP_BUILD_CWEBP=OFF \
  -DWEBP_BUILD_DWEBP=OFF \
  -DWEBP_BUILD_IMG2WEBP=OFF \
  -DWEBP_BUILD_VWEBP=OFF \
  -DWEBP_BUILD_WEBPINFO=OFF \
  -DWEBP_BUILD_WEBPMUX=OFF \
  -DWEBP_BUILD_ANIM_UTILS=OFF \
  -DWEBP_BUILD_EXTRAS=OFF \
  -DWEBP_BUILD_WEBP_JS=OFF \
  -DWEBP_USE_THREAD=OFF \
  -DGIF_INCLUDE_DIR="$GIF_PREFIX/include" \
  -DGIF_LIBRARY="$GIF_PREFIX/lib/libgif.a" \
  -DCMAKE_EXE_LINKER_FLAGS="$EM_LINK"

emmake cmake --build build --target gif2webp -j"$(nproc)"

# SINGLE_FILE=1이면 emscripten은 .js만 emit한다 (.wasm은 인라인됨).
JS=$(find build -name 'gif2webp.js' -print -quit || true)
[ -n "$JS" ] || { echo "ERROR: gif2webp.js 가 생성되지 않음"; exit 1; }

# EXPORT_ES6 출력물은 ES 모듈이므로 .mjs 로 배포한다.
cp "$JS" "$OUT/gif2webp.mjs"

echo ">> 완료. 산출물:"
ls -la "$OUT"
echo ">> SHA-256 (재현성 위해 기록):"
sha256sum "$OUT/gif2webp.mjs"
