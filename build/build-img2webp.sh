#!/usr/bin/env bash
#
# emscripten/emsdk 컨테이너 "안에서" 실행됨 (Dockerfile.img2webp가 호출).
# /out/img2webp.mjs 와 업스트림 라이선스 전문을 생성.
#
# img2webp는 프레임 파일들(PNG/JPEG/WebP/PNM)을 받아 애니메이션 WebP로 묶는다.
# 따라서 gif2webp(giflib만 필요)와 달리 입력 디코더가 필요하다:
#   PNG  -> libpng (-> zlib)
#   JPEG -> libjpeg-turbo
#   WebP/PNM -> libwebp 자체 (추가 의존성 없음)
#
# 코덱은 에뮤스크립튼 ports 대신 소스에서 빌드한다 — 그래야 버전을 versions.env에
# 핀으로 박을 수 있다(결정 #2 소스 빌드, #5 버전 핀). 그런 다음 libwebp CMake의
# find_package(ZLIB/PNG/JPEG)에 우리가 설치한 prefix를 물려 imageio가 PNG/JPEG
# 디코더를 켜고(WEBP_HAVE_PNG/JPEG), libwebp가 img2webp 실행물을 링크한다.
#
# 파이프라인:
#   1. zlib            -> libz.a        (libpng 의존)
#   2. libpng          -> libpng16.a
#   3. libjpeg-turbo   -> libjpeg.a
#   4. libwebp+img2webp-> WASM ES 모듈 (위 3개를 find_package로 물림)
#
set -euo pipefail

: "${LIBWEBP_VERSION:?LIBWEBP_VERSION 누락}"
: "${ZLIB_VERSION:?ZLIB_VERSION 누락}"
: "${LIBPNG_VERSION:?LIBPNG_VERSION 누락}"
: "${LIBJPEGTURBO_VERSION:?LIBJPEGTURBO_VERSION 누락}"

SRC=/work/src
OUT=/out
DEPS=/work/deps          # zlib/libpng/libjpeg-turbo 가 설치되는 공용 prefix
mkdir -p "$SRC" "$OUT" "$DEPS"
cd "$SRC"

NPROC="$(nproc)"

############################################################
# 1) zlib -> libz.a
############################################################
echo ">> [1/4] zlib ${ZLIB_VERSION} 다운로드 + 빌드"
curl -fsSL -o zlib.tar.gz \
  "https://github.com/madler/zlib/releases/download/v${ZLIB_VERSION}/zlib-${ZLIB_VERSION}.tar.gz"
# TODO(재현성): 한 번 돌려보고 타르볼을 신뢰하게 되면 SHA-256 핀 고정.
tar xf zlib.tar.gz
cd "zlib-${ZLIB_VERSION}"
emcmake cmake -B build -S . \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_INSTALL_PREFIX="$DEPS" \
  -DBUILD_SHARED_LIBS=OFF
# zlib 1.3.1 CMake는 BUILD_SHARED_LIBS와 무관하게 shared(zlib)·static(zlibstatic)
# 타깃을 둘 다 만들고, emscripten에선 둘 다 같은 libz.a로 출력된다. 병렬 빌드에서
# 같은 파일을 동시에 써 간헐적으로 실패하고(ranlib: unable to load 'libz.a'), 성공해도
# 어느 쪽이 남을지 실행마다 달라 재현성이 깨진다. static 타깃만 빌드하고 직접 설치한다.
emmake cmake --build build --target zlibstatic -j"$NPROC"
mkdir -p "$DEPS/include" "$DEPS/lib"
cp build/libz.a "$DEPS/lib/"
cp zlib.h build/zconf.h "$DEPS/include/"
# 라이선스 전문 (zlib 라이선스). zlib는 README 말미에 라이선스를 둔다.
cp README "$OUT/zlib-LICENSE.txt" 2>/dev/null || true
cd "$SRC"

############################################################
# 2) libpng -> libpng16.a (zlib 의존)
############################################################
echo ">> [2/4] libpng ${LIBPNG_VERSION} 다운로드 + 빌드"
curl -fsSL -o libpng.tar.gz \
  "https://downloads.sourceforge.net/libpng/libpng-${LIBPNG_VERSION}.tar.gz"
# TODO(재현성): SHA-256 핀 고정.
tar xf libpng.tar.gz
cd "libpng-${LIBPNG_VERSION}"
# wasm엔 ARM/Intel SIMD 최적화가 의미 없으니 끈다. zlib는 우리가 깐 prefix에서 찾게 함.
emcmake cmake -B build -S . \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_INSTALL_PREFIX="$DEPS" \
  -DCMAKE_PREFIX_PATH="$DEPS" \
  -DZLIB_ROOT="$DEPS" \
  -DZLIB_LIBRARY="$DEPS/lib/libz.a" \
  -DZLIB_INCLUDE_DIR="$DEPS/include" \
  -DPNG_SHARED=OFF \
  -DPNG_STATIC=ON \
  -DPNG_FRAMEWORK=OFF \
  -DPNG_TESTS=OFF \
  -DPNG_TOOLS=OFF \
  -DPNG_HARDWARE_OPTIMIZATIONS=OFF
emmake cmake --build build -j"$NPROC"
emmake cmake --install build
cp LICENSE "$OUT/libpng-LICENSE.txt" 2>/dev/null || true
cd "$SRC"

############################################################
# 3) libjpeg-turbo -> libjpeg.a
############################################################
echo ">> [3/4] libjpeg-turbo ${LIBJPEGTURBO_VERSION} 다운로드 + 빌드"
curl -fsSL -o libjpeg-turbo.tar.gz \
  "https://github.com/libjpeg-turbo/libjpeg-turbo/releases/download/${LIBJPEGTURBO_VERSION}/libjpeg-turbo-${LIBJPEGTURBO_VERSION}.tar.gz"
# TODO(재현성): SHA-256 핀 고정.
tar xf libjpeg-turbo.tar.gz
cd "libjpeg-turbo-${LIBJPEGTURBO_VERSION}"
# wasm: SIMD(NASM) 끄고 정적 라이브러리만. TurboJPEG API와 CLI 도구는 불필요.
emcmake cmake -B build -S . \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_INSTALL_PREFIX="$DEPS" \
  -DENABLE_SHARED=OFF \
  -DENABLE_STATIC=ON \
  -DWITH_SIMD=OFF \
  -DWITH_TURBOJPEG=OFF
emmake cmake --build build -j"$NPROC"
emmake cmake --install build
cp LICENSE.md "$OUT/libjpeg-turbo-LICENSE.txt" 2>/dev/null || true
cd "$SRC"

############################################################
# 4) libwebp + img2webp (emscripten이 구동하는 CMake)
############################################################
echo ">> [4/4] libwebp ${LIBWEBP_VERSION} (img2webp) 다운로드 + 빌드"
curl -fsSL -o libwebp.tar.gz \
  "https://github.com/webmproject/libwebp/archive/refs/tags/v${LIBWEBP_VERSION}.tar.gz"
# TODO(재현성): SHA-256 핀 고정.
tar xf libwebp.tar.gz
cd "libwebp-${LIBWEBP_VERSION}"
cp COPYING "$OUT/libwebp-LICENSE.txt" 2>/dev/null || true

# img2webp가 유일하게 빌드되는 실행물(다른 도구 전부 OFF)이므로, 전역 EXE 링커
# 플래그가 이 하나에만 적용된다. callMain + FS를 노출하고 자동 실행을 끄면 JS
# 래퍼가 구동: frame0..N 쓰기 -> callMain(args) -> 가상 FS에서 output.webp 읽기.
#
# 빌드 옵션 근거는 gif2webp와 동일 (SINGLE_FILE / pthread off / node 제외).
# stackSave/stackRestore: callMain은 argv를 wasm 스택에 올리고 되돌리지 않아, 같은
#   모듈로 반복 호출하면 스택이 바닥나 크래시/무한 대기가 된다(프레임 4장 기준 107번째
#   호출). 래퍼가 호출마다 스택 포인터를 복원한다.
EM_LINK="-O3 \
  -sMODULARIZE=1 \
  -sEXPORT_ES6=1 \
  -sEXPORT_NAME=Img2Webp \
  -sEXPORTED_RUNTIME_METHODS=callMain,FS,stackSave,stackRestore \
  -sINVOKE_RUN=0 \
  -sEXIT_RUNTIME=0 \
  -sALLOW_MEMORY_GROWTH=1 \
  -sFORCE_FILESYSTEM=1 \
  -sSINGLE_FILE=1 \
  -sENVIRONMENT=web,worker"

# find_package(ZLIB/PNG/JPEG)에 우리가 깐 prefix를 물린다. 이게 성공해야 libwebp가
# WEBP_HAVE_PNG / WEBP_HAVE_JPEG 를 정의하고 imageio의 pngdec/jpegdec를 실제로 켠다.
# (실패하면 img2webp는 WebP/PNM만 읽고 PNG/JPEG는 "unsupported format"으로 죽음 —
#  빌드 로그에서 "PNG: YES / JPEG: YES" 류 메시지를 반드시 확인할 것.)
emcmake cmake -B build -S . \
  -DCMAKE_BUILD_TYPE=Release \
  -DBUILD_SHARED_LIBS=OFF \
  -DCMAKE_PREFIX_PATH="$DEPS" \
  -DZLIB_ROOT="$DEPS" \
  -DZLIB_LIBRARY="$DEPS/lib/libz.a" \
  -DZLIB_INCLUDE_DIR="$DEPS/include" \
  -DPNG_LIBRARY="$DEPS/lib/libpng16.a" \
  -DPNG_PNG_INCLUDE_DIR="$DEPS/include" \
  -DJPEG_LIBRARY="$DEPS/lib/libjpeg.a" \
  -DJPEG_INCLUDE_DIR="$DEPS/include" \
  -DWEBP_BUILD_IMG2WEBP=ON \
  -DWEBP_BUILD_GIF2WEBP=OFF \
  -DWEBP_BUILD_CWEBP=OFF \
  -DWEBP_BUILD_DWEBP=OFF \
  -DWEBP_BUILD_VWEBP=OFF \
  -DWEBP_BUILD_WEBPINFO=OFF \
  -DWEBP_BUILD_WEBPMUX=OFF \
  -DWEBP_BUILD_ANIM_UTILS=OFF \
  -DWEBP_BUILD_EXTRAS=OFF \
  -DWEBP_BUILD_WEBP_JS=OFF \
  -DWEBP_USE_THREAD=OFF \
  -DCMAKE_EXE_LINKER_FLAGS="$EM_LINK"

emmake cmake --build build --target img2webp -j"$NPROC"

# SINGLE_FILE=1이면 emscripten은 .js만 emit한다 (.wasm은 인라인됨).
JS=$(find build -name 'img2webp.js' -print -quit || true)
[ -n "$JS" ] || { echo "ERROR: img2webp.js 가 생성되지 않음"; exit 1; }

# EXPORT_ES6 출력물은 ES 모듈이므로 .mjs 로 배포한다.
cp "$JS" "$OUT/img2webp.mjs"

echo ">> 완료. 산출물:"
ls -la "$OUT"
echo ">> SHA-256 (재현성 위해 기록):"
sha256sum "$OUT/img2webp.mjs"
