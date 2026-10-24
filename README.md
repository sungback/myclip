# MyClip

단축키 하나로 화면 영역을 캡처해 **클립보드 복사 + 파일 저장**을 동시에 해주는 맥/윈도우 앱.
캡처한 이미지를 AI 챗(ChatGPT, Claude 등)에 바로 `Cmd/Ctrl+V`로 붙여넣을 수 있어요.

## 사용법

### 영역 캡처 — `Alt(⌥)+Shift+S`

1. 화면이 어두워지면 드래그로 영역 선택
2. 손을 떼면 즉시 캡처:
   - 클립보드에 복사 (AI 창에 바로 붙여넣기)
   - `사진/Pictures/MyClip/MyClip_날짜_시간.png` 로 자동 저장
3. 취소는 `Esc` 또는 우클릭

### 창 캡처 — `Alt(⌥)+Shift+W`

현재 활성(맨 앞) 창 전체를 즉시 캡처합니다. 오버레이 없이 바로:
- 클립보드에 복사 + `MyClip_창제목_날짜_시간.png` 로 자동 저장 (파일명에 창 제목 포함)

### 캡처 히스토리 — 트레이 메뉴

트레이 메뉴에 최근 캡처 8개가 표시됩니다. 항목을 클릭하면 **해당 이미지가 클립보드로 다시 복사**됩니다.
여러 장을 캡처한 뒤 AI 챗에 하나씩 붙여넣을 때 유용해요 (캡처할 때마다 클립보드가 덮어져도 히스토리에서 다시 꺼내 쓰면 됨).

트레이 아이콘 메뉴에서 두 캡처를 마우스로 실행하거나 저장 폴더 열기 / 종료할 수 있습니다.

## 개발

```bash
npm install
npm start        # 개발 실행
npm run dist:dir # 현재 OS용으로 패키징 테스트 (dist/ 에 생성, 설치파일 없음)
```

요구사항: Node.js 20+

### macOS 화면 기록 권한

첫 캡처 시 시스템 설정 → 개인정보 보호 → 화면 기록에서
MyClip(개발 중에는 실행한 터미널)을 허용해야 합니다.
거부하면 캡처가 검은 화면으로 나오거나 실패 알림이 뜹니다.

## GitHub에 올려 빌드·배포하기

처음 한 번만:

1. 이 프로젝트의 `package.json` 에서 `GITHUB_USERNAME` 을 본인 GitHub 아이디로 변경 (2곳: `repository.url`, `build.publish[0].owner`)
2. GitHub에 **공개** 저장소 `myclip` 생성 후 push (`package-lock.json` 포함)
3. 로컬 태그로 릴리즈:

```bash
npm version patch   # package.json 버전 자동 상승 + 주석 태그 생성 (0.2.1 → 0.2.2)
git push --follow-tags
# v* 태그 푸시 → GitHub Actions가 맥/윈도우 설치파일을 Releases에 자동 업로드
```

`npm version`은 주석 달린 태그를 만들어서 `--follow-tags`로 함께 올라갑니다.
직접 `git tag v0.2.2` 같은 lightweight 태그를 만들었다면 `git push origin v0.2.2` 로
태그를 따로 푸시해야 워크플로가 실행됩니다.

별도 시크릿 설정이 필요 없습니다. GitHub Actions가 매 실행마다 자동 발급하는
`GITHUB_TOKEN`으로 Releases 업로드를 처리하고, 공개 저장소라서 앱의 자동 업데이트도
토큰 없이 동작합니다.

### 자동 업데이트 현황

| OS | 자동 업데이트 | 비고 |
|---|---|---|
| Windows | ✅ | 새 버전이 있으면 알림 후 자동 설치 |
| macOS | ⏳ 시크릿 등록 대기 | 서명·공증 활성화와 동시에 켜짐 (코드는 준비 완료) |

macOS 서명·공증·자동 업데이트는 GitHub 시크릿 5개만 등록하면 CI가 자동으로 처리합니다
(`MAC_CERTS`, `MAC_CERTS_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`).
시크릿이 없으면 무서명으로, 있으면 서명+공증으로 빌드합니다.

### macOS 서명 없는 앱 처음 실행하기

다운로드한 MyClip이 "손상되었거나 확인할 수 없다"고 뜨면:

```bash
xattr -cr /Applications/MyClip.app
```

또는 우클릭 → 열기. (서명 추가 후에는 불필요해집니다.)

## 구조

```
main.js               메인 프로세스 (단축키, 캡처, 저장, 클립보드, 알림, 트레이)
preload.js            렌더러↔메인 IPC 브리지
src/overlay.html|css|js   영역 선택 오버레이 UI
scripts/gen-icon.js   의존성 없는 아이콘 생성기 (npm run icon)
build/                electron-builder 설정 자산 (아이콘)
.github/workflows/    태그 푸시 시 맥/윈도우 빌드 + Releases 업로드
```
