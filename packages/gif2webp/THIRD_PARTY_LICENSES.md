# 서드파티 라이선스

이 패키지는 아래 서드파티 오픈소스로부터 빌드한 WebAssembly
(`wasm/gif2webp.mjs`에 인라인)를 배포합니다. 각 구성요소는 자체 라이선스를 유지하며 `licenses/` 아래에 전문을 둡니다.

| 구성요소 | 라이선스 | 업스트림 |
|----------|----------|----------|
| libwebp  | BSD-3-Clause | https://chromium.googlesource.com/webm/libwebp |
| giflib   | MIT          | https://giflib.sourceforge.net/ |

- `licenses/libwebp-LICENSE.txt` — libwebp `COPYING` (BSD-3-Clause)
- `licenses/giflib-LICENSE.txt` — giflib `COPYING` (MIT)

이 파일들은 빌드(`build/build.sh`)가 자동으로 채웁니다.

## 수정 사항

libwebp의 `examples/gif2webp.c`를 수정했습니다(BSD-3-Clause가 허용하는 수정·재배포).
리사이즈 옵션(`-resize`, `-resize_fit`, `-resize_down_only`)과 루프 횟수 옵션
(`-loop_count`)을 추가했고, 변경 내용 전체는 레포의 `build/patches/gif2webp.patch`에
있습니다. 그 외 libwebp와 giflib 소스는 수정하지 않았습니다.

이 패키지의 래퍼 코드는 MIT 라이선스입니다(`LICENSE` 참고).
