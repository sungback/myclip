const {
  app,
  globalShortcut,
  BrowserWindow,
  screen,
  desktopCapturer,
  clipboard,
  ClipboardItem,
  ipcMain,
  Tray,
  Menu,
  Notification,
  nativeImage,
  shell,
  dialog,
} = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { execFile } = require("node:child_process");

const HOTKEY = "Alt+Shift+S";
const WINDOW_HOTKEY = "Alt+Shift+W";
const SAVE_DIR_NAME = "MyClip";

let tray = null;
let overlays = [];
let updater = null;

// 트레이 상주 앱은 어떤 비동기 오류로도 죽거나 오류창을 띄우지 않는다
process.on("uncaughtException", (err) => {
  log("미처리 예외(무시):", err);
});
process.on("unhandledRejection", (reason) => {
  log("미처리 거부(무시):", reason);
});

// GUI로 실행된 앱은 stdout이 /dev/null로 가서 콘솔 로그가 사라진다.
// 진단을 위해 모든 [myclip] 로그를 파일에도 남긴다 (userData/myclip.log)
let logFilePath = null;
function log(...args) {
  console.log("[myclip]", ...args);
  try {
    if (!logFilePath) {
      try {
        logFilePath = app.getPath("log");
      } catch {
        // getPath("log")는 로그 디렉토리가 없으면 예외를 던진다 — userData로 대체
        logFilePath = path.join(app.getPath("userData"), "myclip.log");
      }
    }
    const line = `[${new Date().toISOString()}] ${args
      .map((a) => (a instanceof Error ? a.stack || a.message : typeof a === "object" ? JSON.stringify(a) : String(a)))
      .join(" ")}\n`;
    fs.mkdirSync(path.dirname(logFilePath), { recursive: true });
    fs.appendFileSync(logFilePath, line);
  } catch {
    // 로깅 실패는 앱 동작에 영향 주지 않는다
  }
}

function getSaveDir() {
  return path.join(app.getPath("pictures"), SAVE_DIR_NAME);
}

function timestamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` +
    `_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`
  );
}

function notify(title, body, file) {
  const n = new Notification({ title, body });
  if (file) n.on("click", () => shell.showItemInFolder(file));
  n.show();
}

// 이미지를 클립보드로 복사 (Electron 45+ ClipboardItem API). 인코딩된 PNG를 반환
async function writeImageToClipboard(img) {
  const png = img.toPNG();
  await clipboard.write([
    new ClipboardItem({
      "image/png": new Blob([new Uint8Array(png)], { type: "image/png" }),
    }),
  ]);
  return png;
}

const HISTORY_COUNT = 8;

function recentCaptures() {
  const dir = getSaveDir();
  let names = [];
  try {
    names = fs.readdirSync(dir).filter((f) => f.endsWith(".png"));
  } catch {
    return [];
  }
  return names
    .map((f) => {
      const file = path.join(dir, f);
      try {
        return { file, mtime: fs.statSync(file).mtimeMs };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, HISTORY_COUNT);
}

function copyFileToClipboard(file) {
  const img = nativeImage.createFromPath(file);
  if (img.isEmpty()) {
    notify("MyClip", "파일을 읽을 수 없어요.");
    return;
  }
  writeImageToClipboard(img)
    .then(() => notify("MyClip", `클립보드로 복사됨 · ${path.basename(file)}`))
    .catch((err) => {
      console.error("[myclip] 히스토리 복사 오류:", err);
      dialog.showErrorBox("MyClip 오류", String((err && err.message) || err));
    });
}

function buildTrayMenu() {
  const template = [
    { label: `MyClip v${app.getVersion()}`, enabled: false },
    { type: "separator" },
    { label: `영역 캡처  (${HOTKEY})`, click: startCapture },
    { label: `창 캡처  (${WINDOW_HOTKEY})`, click: captureActiveWindow },
  ];

  const recent = recentCaptures();
  if (recent.length > 0) {
    template.push({ type: "separator" });
    for (const r of recent) {
      const label = path
        .basename(r.file)
        .replace(/^MyClip_/, "")
        .replace(/\.png$/, "")
        .slice(0, 45);
      template.push({ label, click: () => copyFileToClipboard(r.file) });
    }
  }

  template.push({ type: "separator" });
  template.push({ label: "업데이트 확인", click: () => checkForUpdatesNow() });
  template.push({ label: "저장 폴더 열기", click: () => shell.openPath(getSaveDir()) });
  template.push({ type: "separator" });
  template.push({ label: "종료", role: "quit" });

  tray.setContextMenu(Menu.buildFromTemplate(template));
}

function createTray() {
  const icon = nativeImage
    .createFromPath(path.join(__dirname, "assets", "icon.png"))
    .resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  tray.setToolTip("MyClip");
  buildTrayMenu();
}

function startCapture() {
  if (overlays.length > 0) return;

  for (const display of screen.getAllDisplays()) {
    const win = new BrowserWindow({
      x: display.bounds.x,
      y: display.bounds.y,
      width: display.bounds.width,
      height: display.bounds.height,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      minimizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      hasShadow: false,
      show: false,
      webPreferences: {
        preload: path.join(__dirname, "preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    });

    win.setAlwaysOnTop(true, "screen-saver");
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    win.loadFile(path.join(__dirname, "src", "overlay.html"));
    win.once("ready-to-show", () => win.show());
    win.on("closed", () => {
      overlays = overlays.filter((w) => w !== win);
    });
    overlays.push(win);
  }
}

function closeOverlays() {
  for (const w of overlays) {
    if (!w.isDestroyed()) w.destroy();
  }
  overlays = [];
}

function sanitizeLabel(title) {
  if (!title) return "";
  return String(title)
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, "_")
    .slice(0, 30);
}

// 클립보드 복사 + 파일 저장 + 알림 (영역/창 캡처 공통)
async function saveCapture(img, label) {
  const png = await writeImageToClipboard(img);

  const dir = getSaveDir();
  fs.mkdirSync(dir, { recursive: true });
  const base = label ? `MyClip_${label}_${timestamp()}` : `MyClip_${timestamp()}`;
  const file = path.join(dir, `${base}.png`);
  fs.writeFileSync(file, png);
  log("저장 완료:", file);

  notify("MyClip 캡처 완료", `클립보드에 복사됨 · ${file}`, file);

  if (tray) buildTrayMenu();
}

async function captureAndSave(display, rect) {
  try {
    // 오버레이 창이 파괴된 직후 화면에 남아 있을 수 있어 캡처 전 잠시 대기
    await new Promise((r) => setTimeout(r, 150));

    const scaleFactor = display.scaleFactor || 1;
    const thumbnailSize = {
      width: Math.round(display.bounds.width * scaleFactor),
      height: Math.round(display.bounds.height * scaleFactor),
    };
    console.log("[myclip] 캡처 시작", { displayId: display.id, scaleFactor, rect, thumbnailSize });

    const sources = await desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize,
    });
    console.log(
      "[myclip] 화면 소스",
      sources.map((s) => {
        const t = s.thumbnail.getSize();
        return `display_id=${s.display_id} ${t.width}x${t.height}`;
      })
    );

    const source =
      sources.find((s) => s.display_id === String(display.id)) || sources[0];
    let img = source ? source.thumbnail : null;

    if (!img || img.isEmpty()) {
      console.error("[myclip] 캡처 실패: 화면 소스가 비어 있음 (화면 기록 권한 의심)");
      dialog.showErrorBox(
        "MyClip 캡처 실패",
        "화면을 가져올 수 없어요.\n\n시스템 설정 → 개인정보 보호 및 보안 → 화면 기록에서 이 앱을 허용해 주세요. 개발 모드(npm start)라면 실행한 터미널 앱을 허용해야 하고, 허용 후에는 앱을 완전히 종료하고 다시 실행해야 합니다."
      );
      return;
    }

    // 오버레이 좌표(DIP)를 실제 캡처 이미지 해상도로 보정
    const size = img.getSize();
    const sx = size.width / display.bounds.width;
    const sy = size.height / display.bounds.height;
    img = img.crop({
      x: Math.max(0, Math.round(rect.x * sx)),
      y: Math.max(0, Math.round(rect.y * sy)),
      width: Math.max(1, Math.round(rect.width * sx)),
      height: Math.max(1, Math.round(rect.height * sy)),
    });

    await saveCapture(img);
  } catch (err) {
    console.error("[myclip] 오류:", err);
    dialog.showErrorBox("MyClip 오류", String((err && err.message) || err));
  }
}

// ---- 창 캡처 (활성 창) ----

// Windows: 전경 창의 HWND/제목/화면좌표(물리픽셀)를 PowerShell로 조회.
// PowerShell 5.1은 stdout을 시스템 코드페이지(한글 윈도우 CP949)로 인코딩하는데
// Node는 UTF-8로 해석해서 한글 제목이 깨진다. Base64로 전송해 코드페이지 무관하게 처리.
function getActiveWindowInfoWin() {
  const script = `
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class MCW {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int a, out RECT r, int c);
  public struct RECT { public int L; public int T; public int R; public int B; }
}
"@
$h = [MCW]::GetForegroundWindow()
$s = New-Object System.Text.StringBuilder 512
[void][MCW]::GetWindowText($h, $s, 512)
$r = New-Object MCW+RECT
[void][MCW]::DwmGetWindowAttribute($h, 9, [ref]$r, 16)
$json = [pscustomobject]@{ hwnd = [int64]$h; title = $s.ToString(); x = $r.L; y = $r.T; w = ($r.R - $r.L); h = ($r.B - $r.T) } | ConvertTo-Json -Compress
[Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($json))
`;
  return new Promise((resolve) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { timeout: 3000 },
      (err, stdout) => {
        if (err || !stdout.trim()) return resolve(null);
        try {
          const json = Buffer.from(stdout.trim(), "base64").toString("utf8");
          resolve(JSON.parse(json));
        } catch {
          resolve(null);
        }
      }
    );
  });
}

// Windows 3차 폴백: 화면 전체 소스에서 창 bounds(물리픽셀)를 크롭.
// 혼합 DPI 다중 모니터에서는 근사치일 수 있다.
async function cropWindowFromScreen(info) {
  const displays = screen.getAllDisplays();
  const disp =
    displays.find((d) => {
      const px = d.bounds.x * d.scaleFactor;
      const py = d.bounds.y * d.scaleFactor;
      return (
        info.x >= px &&
        info.x < px + d.bounds.width * d.scaleFactor &&
        info.y >= py &&
        info.y < py + d.bounds.height * d.scaleFactor
      );
    }) || screen.getPrimaryDisplay();

  const sf = disp.scaleFactor || 1;
  const sources = await desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: {
      width: Math.round(disp.bounds.width * sf),
      height: Math.round(disp.bounds.height * sf),
    },
  });
  const src = sources.find((s) => s.display_id === String(disp.id)) || sources[0];
  const img = src ? src.thumbnail : null;
  if (!img || img.isEmpty()) return null;

  const size = img.getSize();
  const kx = size.width / disp.bounds.width;
  const ky = size.height / disp.bounds.height;
  const cropped = img.crop({
    x: Math.max(0, Math.round((info.x / sf - disp.bounds.x) * kx)),
    y: Math.max(0, Math.round((info.y / sf - disp.bounds.y) * ky)),
    width: Math.max(1, Math.round((info.w / sf) * kx)),
    height: Math.max(1, Math.round((info.h / sf) * ky)),
  });
  return cropped.isEmpty() ? null : cropped;
}

async function captureActiveWindow() {
  try {
    const sources = await desktopCapturer.getSources({
      types: ["window"],
      thumbnailSize: { width: 3840, height: 2160 },
    });

    let img = null;
    let label = "";

    if (process.platform === "darwin") {
      // macOS: 창 소스가 전경창부터 정렬됨(실측 확인). 빈 제목 소스는 건너뛴다.
      const src = sources.find((s) => s.name && !s.thumbnail.isEmpty());
      if (src) {
        img = src.thumbnail;
        label = src.name;
      }
    } else if (process.platform === "win32") {
      const info = await getActiveWindowInfoWin();
      if (info) {
        label = info.title || "";
        const src =
          sources.find((s) => s.id === `window:${info.hwnd}:0`) ||
          (info.title && sources.find((s) => s.name === info.title)) ||
          null;
        if (src && !src.thumbnail.isEmpty()) {
          img = src.thumbnail;
        } else if (info.w > 0 && info.h > 0) {
          img = await cropWindowFromScreen(info);
        }
      }
    }

    if (!img || img.isEmpty()) {
      console.error("[myclip] 창 캡처 실패: 활성 창을 찾지 못함");
      dialog.showErrorBox("MyClip 창 캡처 실패", "캡처할 활성 창을 찾지 못했어요.");
      return;
    }

    console.log("[myclip] 창 캡처:", `"${label}"`, img.getSize());
    await saveCapture(img, sanitizeLabel(label));
  } catch (err) {
    console.error("[myclip] 창 캡처 오류:", err);
    dialog.showErrorBox("MyClip 오류", String((err && err.message) || err));
  }
}

ipcMain.on("selection-started", (e) => {
  // 한 모니터에서 드래그가 시작되면 나머지 모니터의 오버레이는 닫는다
  for (const w of overlays) {
    if (!w.isDestroyed() && w.webContents !== e.sender) w.destroy();
  }
  overlays = overlays.filter((w) => !w.isDestroyed());
});

ipcMain.on("selection-finished", (e, rect) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const display = win
    ? screen.getDisplayMatching(win.getBounds())
    : screen.getPrimaryDisplay();
  closeOverlays();
  captureAndSave(display, rect);
});

ipcMain.on("selection-cancelled", () => closeOverlays());

// ---- 자동 업데이트 ----
// Windows는 항상, macOS는 zip 아티팩트 기반으로 동작(무서명 가능).
// 모든 과정을 파일 로그로 남겨 진단 가능하게 한다.
function setupAutoUpdater() {
  if (!(app.isPackaged && (process.platform === "win32" || process.platform === "darwin"))) return;
  const { autoUpdater } = require("electron-updater");
  updater = autoUpdater;
  autoUpdater.logger = {
    info: (...a) => log("업데이터:", ...a),
    warn: (...a) => log("업데이터 경고:", ...a),
    error: (...a) => log("업데이터 오류:", ...a),
    debug: () => {},
  };
  autoUpdater.on("checking-for-update", () => log("업데이트 확인 시작"));
  autoUpdater.on("update-available", (i) => log(`새 버전 발견: ${i && i.version}`));
  autoUpdater.on("update-not-available", () => log("최신 버전 사용 중:", app.getVersion()));
  autoUpdater.on("download-progress", (p) =>
    log(
      `다운로드 ${Math.round(p.percent)}% (${(p.transferred / 1048576).toFixed(1)}/${(
        p.total / 1048576
      ).toFixed(1)}MB)`
    )
  );
  autoUpdater.on("update-downloaded", (i) =>
    log(`다운로드 완료: ${i.version} — 앱 종료 시 자동 설치됩니다`)
  );
  autoUpdater.on("error", (err) => log("업데이트 실패(무시됨):", err));
}

function checkForUpdatesNow() {
  if (!updater) {
    notify("MyClip", "이 실행 환경에서는 자동 업데이트를 지원하지 않아요.");
    return;
  }
  updater.checkForUpdatesAndNotify().catch((e) => log("업데이트 확인 실패(무시됨):", e));
}

// 테스트 모드(MYCLIP_TEST_*)에서는 싱글 인스턴스 락을 우회해
// 이미 실행 중인 앱 옆에서도 자동 테스트가 가능하게 한다
const isTestMode =
  process.env.MYCLIP_TEST_CAPTURE === "1" || process.env.MYCLIP_TEST_WINDOW === "1";
const gotLock = isTestMode || app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    // 이미 실행 중이면 캡처 모드로 대응하지 않고 무시
  });

  app.whenReady().then(() => {
    if (process.platform === "darwin") app.dock.hide();
    log("앱 시작, 버전:", app.getVersion(), "패키지:", app.isPackaged);
    createTray();

    const registered = globalShortcut.register(HOTKEY, startCapture);
    if (!registered) {
      notify("MyClip", `단축키(${HOTKEY}) 등록에 실패했어요. 다른 앱과 겹치는지 확인해 주세요.`);
    }

    const windowRegistered = globalShortcut.register(WINDOW_HOTKEY, captureActiveWindow);
    if (!windowRegistered) {
      notify("MyClip", `단축키(${WINDOW_HOTKEY}) 등록에 실패했어요. 다른 앱과 겹치는지 확인해 주세요.`);
    }

    // 자동 업데이트: 시작 시 1회 + 6시간마다 + 트레이 메뉴 수동 확인
    setupAutoUpdater();
    checkForUpdatesNow();
    setInterval(checkForUpdatesNow, 6 * 60 * 60 * 1000);

    // 개발 디버깅용: MYCLIP_TEST_CAPTURE=1 로 실행하면 자동으로 고정 영역을 캡처한다
    if (process.env.MYCLIP_TEST_CAPTURE === "1") {
      setTimeout(() => {
        const d = screen.getPrimaryDisplay();
        console.log("[myclip] 자동 캡처 테스트 시작");
        captureAndSave(d, { x: 50, y: 50, width: 300, height: 200 }).finally(() => {
          console.log("[myclip] 자동 캡처 테스트 종료");
          setTimeout(() => app.quit(), 800);
        });
      }, 2000);
    }

    // 개발 디버깅용: MYCLIP_TEST_WINDOW=1 로 실행하면 활성 창을 자동 캡처한다
    if (process.env.MYCLIP_TEST_WINDOW === "1") {
      setTimeout(() => {
        console.log("[myclip] 창 자동 캡처 테스트 시작");
        captureActiveWindow().finally(() => {
          console.log("[myclip] 창 자동 캡처 테스트 종료");
          setTimeout(() => app.quit(), 800);
        });
      }, 2000);
    }
  });

  app.on("will-quit", () => globalShortcut.unregisterAll());

  app.on("window-all-closed", () => {
    // 트레이 상주 앱이라 종료하지 않는다
  });
}
