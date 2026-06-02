# 서드파티 라이선스

이 패키지는 아래 서드파티 오픈소스로부터 빌드한 WebAssembly(`wasm/img2webp.mjs`에
인라인됨)를 배포합니다. 소스는 수정하지 않고 WASM으로 컴파일만 했습니다. 각
구성요소는 자체 라이선스를 유지하며 `licenses/` 아래에 전문을 둡니다.

| 구성요소 | 라이선스 | 업스트림 |
|----------|----------|----------|
| libwebp        | BSD-3-Clause            | https://chromium.googlesource.com/webm/libwebp |
| libpng         | PNG Reference Library License v2 | http://www.libpng.org/pub/png/libpng.html |
| zlib           | Zlib License            | https://zlib.net/ |
| libjpeg-turbo  | IJG + BSD-3-Clause + Zlib | https://libjpeg-turbo.org/ |

- `licenses/libwebp-LICENSE.txt` — libwebp `COPYING` (BSD-3-Clause)
- `licenses/libpng-LICENSE.txt` — libpng `LICENSE`
- `licenses/zlib-LICENSE.txt` — zlib `README` 내 라이선스 고지
- `licenses/libjpeg-turbo-LICENSE.txt` — libjpeg-turbo `LICENSE.md`

libpng/zlib/libjpeg-turbo는 img2webp가 PNG/JPEG 프레임을 디코딩하기 위해
링크됩니다. 이 파일들은 빌드(`build/build-img2webp.sh`)가 자동으로 채웁니다.
이 패키지의 래퍼 코드는 MIT 라이선스입니다(`LICENSE` 참고).
