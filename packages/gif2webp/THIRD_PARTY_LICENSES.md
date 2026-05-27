# 서드파티 라이선스

이 패키지는 아래 서드파티 오픈소스로부터 빌드한 WebAssembly
(`wasm/gif2webp.wasm`)를 배포합니다. 소스는 수정하지 않고 WASM으로 컴파일만
했습니다. 각 구성요소는 자체 라이선스를 유지하며 `licenses/` 아래에 전문을 둡니다.

| 구성요소 | 라이선스 | 업스트림 |
|----------|----------|----------|
| libwebp  | BSD-3-Clause | https://chromium.googlesource.com/webm/libwebp |
| giflib   | MIT          | https://giflib.sourceforge.net/ |

- `licenses/libwebp-LICENSE.txt` — libwebp `COPYING` (BSD-3-Clause)
- `licenses/giflib-LICENSE.txt` — giflib `COPYING` (MIT)

이 파일들은 빌드(`build/build.sh`)가 자동으로 채웁니다.
이 패키지의 래퍼 코드는 MIT 라이선스입니다(`LICENSE` 참고).
