# webp-tools 모노레포의 재현 가능 WASM 빌드.
#
# 본인(메인테이너)이 .wasm을 재빌드할 때'만' 실행됨 — 설치 시점도, 브라우저에서도
# 절대 안 돎. 소비자는 그냥 `pnpm add @btheegg-kimth/gif2webp`로 prebuilt 산출물을
# 받는다. Docker는 순전히 "오늘의 나, 내년의 나, CI"가 동일한 .wasm을 뽑기 위함.
#
# build/build-docker.sh 로 빌드 + 산출물 추출 (BuildKit --output 사용).

ARG EMSDK_VERSION=3.1.74
# 의도적으로 amd64 고정. 핀 박은 emsdk 태그(3.1.74 검증 완료)가 amd64 single-arch
# manifest로 발행돼 있고, 산출물(.wasm/.mjs)은 어차피 아키텍처 독립적이라 호스트가
# Apple Silicon이든 Linux x86이든 같은 바이트가 나옴(SHA-256 재현 가능). Apple
# Silicon에선 Rosetta로 컴파일이 다소 느릴 뿐 결과는 동일. ARG로 빼서 BuildKit
# 린트 통과 + 필요 시 호출자가 덮어쓸 수 있게.
ARG BUILD_PLATFORM=linux/amd64
FROM --platform=${BUILD_PLATFORM} emscripten/emsdk:${EMSDK_VERSION} AS builder

ARG LIBWEBP_VERSION=1.6.0
ARG GIFLIB_VERSION=5.2.2
ENV LIBWEBP_VERSION=${LIBWEBP_VERSION} \
    GIFLIB_VERSION=${GIFLIB_VERSION}

# emsdk 이미지엔 cmake/make/python이 이미 들어있고, curl만 추가한다.
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates cmake \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /work
COPY build.sh /work/build.sh
RUN chmod +x /work/build.sh && /work/build.sh

# 추출 전용 스테이지: 산출물 외엔 아무것도 없어서
# `docker build --output type=local`이 호스트에 깔끔한 폴더를 떨군다.
FROM scratch AS export
COPY --from=builder /out/ /
