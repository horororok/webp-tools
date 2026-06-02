# webp-tools

브라우저가 **네이티브로 못 하는** [libwebp](https://chromium.googlesource.com/webm/libwebp)
도구들의 WASM 빌드 — `@btheegg-kimth/*` 스코프로 배포해 어느 프로젝트든 필요한
조각만 가져다 쓸 수 있게 합니다.

브라우저는 이미 정적 이미지를 WebP로 인코딩하고(`canvas.toBlob('image/webp')`)
WebP를 네이티브 디코딩하므로, `cwebp`/`dwebp`는 **일부러** 빌드하지 않습니다.
남는 건 진짜 공백뿐:

| 패키지 | 상태 | 하는 일 |
|--------|------|---------|
| [`@btheegg-kimth/gif2webp`](https://www.npmjs.com/package/@btheegg-kimth/gif2webp) ([src](packages/gif2webp)) | [![npm](https://img.shields.io/npm/v/@btheegg-kimth/gif2webp.svg)](https://www.npmjs.com/package/@btheegg-kimth/gif2webp) | 애니메이션 GIF → 애니메이션 WebP |
| `@btheegg-kimth/img2webp` ([src](packages/img2webp)) | 빌드 완료 · 배포 대기 | 프레임들(PNG/JPEG/WebP) → 애니메이션 WebP |
| `@btheegg-kimth/webpmux`  | 예정 | WebP 컨테이너 / 메타데이터 편집 |

모든 도구는 하나의 libwebp 코어와 하나의 빌드 파이프라인을 공유하므로 다음 도구
추가는 저렴합니다. 실제로 필요한 것만, 필요해질 때 만듭니다.

## 레포 구조

```
webp-tools/
├── build/                          # 공유 재현 가능 WASM 빌드 파이프라인
│   ├── Dockerfile                  # gif2webp: emscripten + scratch export 스테이지
│   ├── build.sh                    # giflib + libwebp + gif2webp -> wasm
│   ├── build-docker.sh             # 호스트 오케스트레이터 (gif2webp)
│   ├── Dockerfile.img2webp         # img2webp: 코덱 소스 빌드 추가
│   ├── build-img2webp.sh           # zlib+libpng+libjpeg-turbo + libwebp + img2webp -> wasm
│   ├── build-docker-img2webp.sh    # 호스트 오케스트레이터 (img2webp)
│   ├── versions.env                # 핀 박은 emsdk / libwebp / giflib / 코덱 버전
│   └── versions.lock               # 산출물 SHA-256
└── packages/
    ├── gif2webp/
    │   ├── src/index.ts            # 타입 래퍼
    │   ├── wasm/                   # 커밋되는 빌드 산출물 (배포 대상물)
    │   └── licenses/               # 업스트림 라이선스 전문 (빌드가 채움)
    └── img2webp/                   # 동일 구조 (wasm/ 빌드 완료, 배포 대기)
```

## WASM 빌드 (메인테이너 전용 — Docker 필요)

```sh
pnpm install
pnpm build:wasm            # gif2webp -> packages/gif2webp/wasm/
pnpm build:wasm:img2webp   # img2webp -> packages/img2webp/wasm/
```

Docker는 **오직** 여기서, 재빌드할 때만 돕니다. 소비자는 절대 실행하지 않습니다.
도구마다 빌드 trio(Dockerfile + 컨테이너 스크립트 + 호스트 스크립트)가 분리돼
있어 한 도구 빌드가 다른 도구에 영향을 주지 않습니다.

## 패키지 빌드

```sh
pnpm -r build          # tsdown: src/index.ts -> dist/index.mjs + .d.mts
```

## 수동 QA (브라우저 실측)

```sh
pnpm qa                # dist 빌드 후 examples/playground Vite dev 서버 실행
```

브라우저에서 열고 GIF를 변환해 동작 확인. 라이브러리가 `ENVIRONMENT=web,worker`로
빌드돼 Node 실행이 안 되므로(브라우저 전용), 검증은 실제 브라우저에서 한다.

## 배포 (최초)

```sh
# 1회성: 무료 npm org `btheegg-kimth` 생성, 2FA 활성화, 그다음:
npm login
cd packages/gif2webp
npm publish            # publishConfig.access=public 가 스코프드 기본 private 처리
```

## 업스트림 버전 올리기

`build/versions.env` 수정 → `pnpm build:wasm` 재실행 → 새 wasm SHA-256 기록 →
패키지 버전 올림(semver) → 재배포.
