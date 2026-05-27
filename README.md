# webp-tools

브라우저가 **네이티브로 못 하는** [libwebp](https://chromium.googlesource.com/webm/libwebp)
도구들의 WASM 빌드 — `@btheegg-kimth/*` 스코프로 배포해 어느 프로젝트든 필요한
조각만 가져다 쓸 수 있게 합니다.

브라우저는 이미 정적 이미지를 WebP로 인코딩하고(`canvas.toBlob('image/webp')`)
WebP를 네이티브 디코딩하므로, `cwebp`/`dwebp`는 **일부러** 빌드하지 않습니다.
남는 건 진짜 공백뿐:

| 패키지 | 상태 | 하는 일 |
|--------|------|---------|
| [`@btheegg-kimth/gif2webp`](packages/gif2webp) | 빌드 중 | 애니메이션 GIF → 애니메이션 WebP |
| `@btheegg-kimth/img2webp` | 예정 | 프레임들 → 애니메이션 WebP |
| `@btheegg-kimth/webpmux`  | 예정 | WebP 컨테이너 / 메타데이터 편집 |

모든 도구는 하나의 libwebp 코어와 하나의 빌드 파이프라인을 공유하므로 다음 도구
추가는 저렴합니다. 실제로 필요한 것만, 필요해질 때 만듭니다.

## 레포 구조

```
webp-tools/
├── build/                  # 공유 재현 가능 WASM 빌드 파이프라인
│   ├── Dockerfile          # emscripten 환경 + scratch export 스테이지
│   ├── build.sh            # giflib + libwebp + gif2webp -> wasm (컨테이너 안에서)
│   ├── build-docker.sh     # 호스트 오케스트레이터 (docker build + 추출)
│   └── versions.env        # 핀 박은 emsdk / libwebp / giflib 버전
└── packages/
    └── gif2webp/
        ├── src/index.ts    # 타입 래퍼
        ├── wasm/           # 커밋되는 빌드 산출물 (배포 대상물)
        └── licenses/       # 업스트림 라이선스 전문 (빌드가 채움)
```

## WASM 빌드 (메인테이너 전용 — Docker 필요)

```sh
pnpm install
pnpm build:wasm        # Docker로 빌드, 산출물을 packages/gif2webp/wasm/에 떨굼
```

Docker는 **오직** 여기서, 재빌드할 때만 돕니다. 소비자는 절대 실행하지 않습니다.

## 패키지 빌드

```sh
pnpm -r build          # tsdown: src/index.ts -> dist/index.mjs + .d.mts
```

## 스모크 테스트

```sh
pnpm smoke             # 내장 2프레임 GIF로 E2E 검증
```

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

## 가이드 문서

- [`docs/01-create-npm-library.md`](docs/01-create-npm-library.md) — 첫 패키지를 처음부터
  npm public 배포까지 (이 레포가 거친 풀스택 과정)
- [`docs/02-add-package-to-org.md`](docs/02-add-package-to-org.md) — 같은 org에 새 패키지
  추가하는 빠른 워크플로 (img2webp, webpmux 등)
