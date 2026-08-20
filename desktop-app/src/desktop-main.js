import path from 'node:path';
import crypto from 'node:crypto';
import { app, BrowserWindow, clipboard, dialog, Menu, nativeImage, shell, Tray } from 'electron';
import { compareVersions, fetchLatestRelease } from './release-update.js';

const REPOSITORY = 'fanxiaolongx-max/ppo-traffic-autofill';
const RELEASES_URL = `https://github.com/${REPOSITORY}/releases`;

let mainWindow;
let tray;
let serverModule;
let boundPort;
let checkingUpdate = false;
const desktopToken = process.env.PPO_DESKTOP_TOKEN || crypto.randomBytes(32).toString('hex');
process.env.PPO_DESKTOP_TOKEN = desktopToken;

function localBaseUrl() {
  const publicBaseUrl = String(process.env.PPO_PUBLIC_BASE_URL || '').replace(/\/$/, '');
  return publicBaseUrl || `http://127.0.0.1:${boundPort}`;
}

function userUrl() { return `${localBaseUrl()}/`; }
function adminUrl() { return `${localBaseUrl()}/admin`; }

function loginItemOptions(openAtLogin) {
  if (process.platform === 'darwin') return { openAtLogin };
  return {
    openAtLogin,
    path: process.execPath,
    args: app.isPackaged ? ['--hidden'] : [app.getAppPath(), '--hidden']
  };
}

function isLoginEnabled() {
  return app.getLoginItemSettings().openAtLogin;
}

function setLoginEnabled(enabled) {
  app.setLoginItemSettings(loginItemOptions(enabled));
  rebuildTrayMenu();
}

async function showMainWindow() {
  if (!mainWindow) {
    await createWindow({ show: true });
    return;
  }
  if (process.platform === 'darwin') await app.dock?.show();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  rebuildTrayMenu();
}

function hideMainWindow() {
  if (!mainWindow) return;
  mainWindow.hide();
  if (process.platform === 'darwin') app.dock?.hide();
  rebuildTrayMenu();
}

async function checkForUpdates({ interactive = true } = {}) {
  if (checkingUpdate) return;
  checkingUpdate = true;
  rebuildTrayMenu();
  try {
    const release = await fetchLatestRelease(REPOSITORY, globalThis.fetch, {
      token: process.env.PPO_GITHUB_TOKEN || '',
      manifestUrl: process.env.PPO_UPDATE_MANIFEST_URL || ''
    });
    const currentVersion = app.getVersion();
    if (compareVersions(release.version, currentVersion) > 0) {
      const result = await dialog.showMessageBox({
        type: 'info',
        title: '发现新版本',
        message: `发现新版本 ${release.version}`,
        detail: `当前版本：${currentVersion}\n最新版本：${release.version}\n\n点击“前往下载”打开 GitHub Release 页面。`,
        buttons: ['前往下载', '稍后'],
        defaultId: 0,
        cancelId: 1
      });
      if (result.response === 0) await shell.openExternal(release.url);
    } else if (interactive) {
      await dialog.showMessageBox({
        type: 'info',
        title: '检查更新',
        message: '当前已是最新版本',
        detail: `当前版本：${currentVersion}`,
        buttons: ['好']
      });
    }
  } catch (error) {
    if (interactive) {
      await dialog.showMessageBox({
        type: 'warning',
        title: '暂时无法检查更新',
        message: '未能读取 GitHub 最新版本信息',
        detail: error.message,
        buttons: ['好']
      });
    }
  } finally {
    checkingUpdate = false;
    rebuildTrayMenu();
  }
}

function trayMenuTemplate() {
  const visible = Boolean(mainWindow?.isVisible());
  return [
    { label: `埃及车辆违章查询  v${app.getVersion()}`, enabled: false },
    { label: boundPort ? `● 服务运行中 · 端口 ${boundPort}` : '○ 服务正在启动', enabled: false },
    { type: 'separator' },
    { label: visible ? '隐藏主窗口' : '显示主窗口', click: () => (visible ? hideMainWindow() : showMainWindow()) },
    { label: '在默认浏览器打开用户页面', enabled: Boolean(boundPort), click: () => shell.openExternal(userUrl()) },
    { label: '在默认浏览器打开管理员页面', enabled: Boolean(boundPort), click: () => shell.openExternal(adminUrl()) },
    { label: '复制访问地址', enabled: Boolean(boundPort), click: () => clipboard.writeText(userUrl()) },
    { type: 'separator' },
    { label: app.isPackaged ? '开机自动启动' : '开机自动启动（打包版可用）', type: 'checkbox', checked: isLoginEnabled(), enabled: app.isPackaged, click: item => setLoginEnabled(item.checked) },
    { label: checkingUpdate ? '正在检查更新…' : '检查版本更新…', enabled: !checkingUpdate, click: () => checkForUpdates() },
    { label: '打开 GitHub 发布页', click: () => shell.openExternal(RELEASES_URL) },
    { type: 'separator' },
    { label: '退出程序并停止服务', click: () => app.quit() }
  ];
}

function rebuildTrayMenu() {
  if (!tray || tray.isDestroyed()) return;
  tray.setContextMenu(Menu.buildFromTemplate(trayMenuTemplate()));
}

function createMacTrayIcon() {
  // macOS menu-bar icons must be monochrome template images with transparency.
  // Draw a 2x raw bitmap directly. Packaged Electron builds do not reliably
  // decode SVG data URLs in nativeImage, which previously made startup fail.
  const width = 36;
  const height = 36;
  const bitmap = Buffer.alloc(width * height * 4);
  const fillRect = (left, top, right, bottom) => {
    for (let y = top; y < bottom; y += 1) {
      for (let x = left; x < right; x += 1) {
        const offset = (y * width + x) * 4;
        bitmap[offset + 3] = 255;
      }
    }
  };
  // Compact vehicle silhouette plus three status lamps.
  fillRect(8, 15, 28, 25);
  fillRect(11, 11, 25, 15);
  fillRect(5, 19, 31, 25);
  fillRect(8, 25, 14, 30);
  fillRect(22, 25, 28, 30);
  fillRect(8, 5, 12, 9);
  fillRect(16, 5, 20, 9);
  fillRect(24, 5, 28, 9);
  const icon = nativeImage.createFromBitmap(bitmap, { width, height, scaleFactor: 2 });
  icon.setTemplateImage(true);
  return icon;
}

function createTray() {
  if (tray) return;
  let trayIcon;
  if (process.platform === 'darwin') {
    trayIcon = createMacTrayIcon();
  } else {
    const iconPath = path.join(app.getAppPath(), 'assets', 'icon.icns');
    trayIcon = nativeImage.createFromPath(iconPath);
    if (!trayIcon.isEmpty()) trayIcon = trayIcon.resize({ width: 18, height: 18 });
  }
  if (trayIcon.isEmpty()) throw new Error('无法加载系统托盘图标');
  tray = new Tray(trayIcon);
  tray.setToolTip(`埃及车辆违章查询 · 端口 ${boundPort}`);
  tray.on('double-click', () => showMainWindow());
  rebuildTrayMenu();
}

async function createWindow({ show = true } = {}) {
  try {
    if (!serverModule) {
      const userData = app.getPath('userData');
      process.env.PPO_DATA_DIR ||= path.join(userData, 'data');
      process.env.PPO_LOG_DIR ||= path.join(userData, 'logs');
      serverModule = await import('./server.js');
    }
    ({ port: boundPort } = await serverModule.serverReady);
    createTray();
    mainWindow = new BrowserWindow({
      width: 980,
      height: 860,
      minWidth: 390,
      minHeight: 620,
      show: false,
      title: '埃及车辆违章查询',
      backgroundColor: '#090d14',
      autoHideMenuBar: true,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });
    mainWindow.once('ready-to-show', () => (show ? showMainWindow() : hideMainWindow()));
    await mainWindow.webContents.session.clearCache();
    await mainWindow.loadURL(`http://127.0.0.1:${boundPort}/?build=${Date.now()}#desktopToken=${encodeURIComponent(desktopToken)}`);
    mainWindow.on('minimize', event => {
      if (app.__ppoClosing) return;
      event.preventDefault();
      hideMainWindow();
    });
    mainWindow.on('close', event => {
      if (app.__ppoClosing) return;
      event.preventDefault();
      hideMainWindow();
    });
    mainWindow.on('show', rebuildTrayMenu);
    mainWindow.on('hide', rebuildTrayMenu);
    mainWindow.on('closed', () => { mainWindow = null; });
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:/.test(url)) shell.openExternal(url);
      return { action: 'deny' };
    });
  } catch (error) {
    dialog.showErrorBox('埃及车辆违章查询启动失败', error.message);
    app.quit();
  }
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => showMainWindow());
  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    const loginLaunch = Boolean(app.getLoginItemSettings().wasOpenedAtLogin);
    const startHidden = loginLaunch || process.argv.includes('--hidden');
    createWindow({ show: !startHidden });
    app.on('activate', () => showMainWindow());
  });
}

app.on('window-all-closed', () => {
  // 托盘程序保持服务运行；只能从托盘“退出程序”或系统退出命令结束。
});

app.on('before-quit', event => {
  if (app.__ppoClosing) return;
  event.preventDefault();
  app.__ppoClosing = true;
  tray?.destroy();
  (serverModule?.shutdownServer('desktop_quit') || Promise.resolve()).finally(() => app.quit());
});
