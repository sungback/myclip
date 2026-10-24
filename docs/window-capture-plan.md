# 창 캡처 기능 계획 (v0.2.0)

작성: 2026-10-25 · 상태: **구현 완료 (v0.2.0)** — macOS 자동 테스트 통과(활성창 "ZCode" 3678×2160 캡처 + 창제목 파일명 저장, 영역 캡처 회귀 통과). Windows 경로는 사용자 윈도우 머신 확인 필요.

## 목표

드래그 영역 캡처(⌥+Shift+S)에 더해, **활성(전경) 창 전체를 한 번에 캡처**하는 모드를 추가한다.

- 새 단축키: **⌥(Alt)+Shift+W** — 누르는 즉시 현재 포커스된 창을 캡처 (오버레이 없음, 클릭 0회)
- 트레이 메뉴에 "창 캡처" 항목 추가
- 결과물은 기존 파이프라인 그대로: 클립보드 PNG 복사 + `~/Pictures/MyClip` 자동 저장 + 알림
- 파일명에 창 제목 포함: `MyClip_<창제목>_<타임스탬프>.png`

## 검증된 기술 사실 (2026-10-25 실측)

1. **macOS 창 소스 순서**: `desktopCapturer.getSources({types:['window']})` 결과가 전경창부터 정렬됨을 확인. 실측에서 맨 앞의 ZCode 창이 `sources[0]`. 소스 `id`는 `window:<CGWindowID>:0` 형식이고 `name`은 창 제목.
2. **창 썸네일 = 창 이미지**: window 타입 소스의 thumbnail은 창 프레임만 포함(배경·그림자 제외, 픽셀 퍼펙트). 좌표 계산·DPI 보정이 아예 불필요.
3. JXA(osascript)의 CGWindowList 직접 호출은 브리징 문제로 실패 → 순서 기반 방식이 더 견고한 대안.

## 구현 설계

### 1. main.js 리팩터 (저장 파이프라인 공유화)

`captureAndSave()`에서 "이미지 확정 후 → 클립보드 복사 + 파일 저장 + 알림" 부분을 `saveCapture(img, label)`로 추출. 기존 영역 캡처와 창 캡처가 함께 사용.

### 2. `captureActiveWindow()` 신규 함수

```
getSources({ types:['window'], thumbnailSize: {3840x2160} })  // 창 실제 크기 이상으로 요청
```

**macOS**: `sources[0]`의 thumbnail 사용 (전경창). MyClip은 보이는 창이 없는 트레이 앱이라 자기 자신이 끼지 않음.
방어 코드: `sources[0].name`이 비어있으면 다음 후보로 스킵(비정상 창 필터).

**Windows**: PowerShell 1회 실행으로 전경 창 핸들 확보 → 소스 매칭:

```powershell
Add-Type user32; GetForegroundWindow() → HWND
DwmGetWindowAttribute(DWMWA_EXTENDED_FRAME_BOUNDS) → (폴백용 bounds)
GetWindowText(HWND) → (폴백용 title)
```

- 1차: `window:<HWND>:0` id 매칭 → thumbnail
- 2차 폴백: title 매칭
- 3차 폴백: bounds를 DIP 변환 후 화면 소스에서 크롭 (기존 영역 캡처 로직 재사용)

**실패 시**: 기존 패턴 그대로 `dialog.showErrorBox` (소스 비면 권한 안내 유지).

### 3. 단축키·트레이 메뉴

- `globalShortcut.register("Alt+Shift+W", captureActiveWindow)`
- 트레이: `{ label: "창 캡처 (활성 창)", click: captureActiveWindow }` — 기존 "영역 캡처" 아래

### 4. 파일명 정제

창 제목에서 `/ \ : * ? " < > |` 제거 + 30자 절단 + 공백→언더스코어. 제목 없으면 종래 타임스탬프만.

### 5. 자동 테스트 훅

`MYCLIP_TEST_WINDOW=1` 실행 시 2초 후 활성 창 캡처 → 로그(제목·픽셀 크기) → 종료. 기존 `MYCLIP_TEST_CAPTURE` 패턴과 동일.

### 6. 문서·버전

- README에 새 단축키 추가
- `package.json` version → **0.2.0**

## 리스크와 대응

| 리스크 | 영향 | 대응 |
|---|---|---|
| macOS 소스 순서가 비공식 동작 | 업데이트로 변경 가능성 | 실측 유지 + 빈 이름 스킵 방어. 변경 시 title 매칭 폴백으로 전환 가능 |
| Windows 경로는 이 맥 환경에서 테스트 불가 | 1차 배포 후 확인 필요 | 3단 폴백 설계로 실패해도 크롭 캡처로 동작. 사용자 윈도우 머신에서 확인 후 CI 배포 |
| 썸네일 최대 해상도 제한 | 4K 초과 창 축소 가능 | 실측 확인, 필요시 분할 요청 |
| Alt+Shift+S에 이미 익숙(IME 스위치와 무충돌 확인됨) | 없음 | Alt+Shift+W 동일 패턴 |

## 범위 외 (Phase 2 후보 — 별도 계획)

- **오버레이 클릭 방식**: 영역 선택 화면에서 드래그 대신 창을 클릭하면 그 창 캡처. macOS는 전체 창 목록+bounds가 필요해 Accessibility 권한 추가 또는 Swift 헬퍼 컴파일 필요. Windows는 EnumWindows로 무권한 가능.
- hover 하이라이트 미리보기, 창 피커 그리드 UI, 캡처에서 제외할 앱 목록

## 작업량

- main.js 약 +130줄 (함수 1개, 헬퍼 2개, 등록 코드)
- 신규 의존성 **0**, 신규 권한 **0** (macOS 화면 기록 권한 재사용)
- 예상 소요: 구현+자동 테스트 1세션
