import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { app, BrowserWindow, clipboard, dialog, Menu, nativeImage, Notification, shell, Tray } from 'electron';
import { compareVersions, fetchLatestRelease } from './release-update.js';
import { StableGateway } from './gateway.js';
import { CoreManager } from './core-manager.js';

const REPOSITORY = 'fanxiaolongx-max/ppo-traffic-autofill';
const RELEASES_URL = `https://github.com/${REPOSITORY}/releases`;

let mainWindow;
let tray;
let serverModule;
let gateway;
let coreManager;
let activeCore;
let boundPort;
let checkingUpdate = false;
let checkingCoreUpdate = false;
let switchingCore = false;
let availableCoreRelease;
let coreUpdateError = '';
let updateNotification;
const desktopToken = process.env.PPO_DESKTOP_TOKEN || crypto.randomBytes(32).toString('hex');
process.env.PPO_DESKTOP_TOKEN = desktopToken;

function localBaseUrl() {
  const publicBaseUrl = String(process.env.PPO_PUBLIC_BASE_URL || '').replace(/\/$/, '');
  return publicBaseUrl || `http://127.0.0.1:${boundPort}`;
}

function userUrl() { return `${localBaseUrl()}/`; }
function adminUrl() { return `${localBaseUrl()}/admin`; }

function coreStatus() {
  return {
    ...coreManager?.status(activeCore?.version),
    checking: checkingCoreUpdate,
    switching: switchingCore,
    available: availableCoreRelease || null,
    error: coreUpdateError || null
  };
}

async function importCore(descriptor) {
  process.env.PPO_HOST = '127.0.0.1';
  process.env.PPO_PORT = '0';
  process.env.PPO_PORT_AUTO_INCREMENT = 'false';
  process.env.PPO_CORE_VERSION = descriptor.version;
  globalThis.__PPO_CORE_SHELL__ = true;
  const entry = pathToFileURL(path.join(descriptor.root, 'src', 'server.js'));
  entry.searchParams.set('instance', `${Date.now()}-${crypto.randomUUID()}`);
  const module = await import(entry.href);
  const ready = await module.serverReady;
  return { descriptor, module, port: ready.port };
}

async function coreHealth(port, expectedVersion) {
  const response = await fetch(`http://127.0.0.1:${port}/api/v1/health`, { signal: AbortSignal.timeout(10_000) });
  const payload = await response.json();
  if (!response.ok || !payload.ok || payload.version !== expectedVersion) throw new Error(`新核心健康检查失败（HTTP ${response.status}，版本 ${payload.version || '未知'}）`);
  return payload;
}

async function switchToCore(descriptor, { reason = 'manual_update' } = {}) {
  if (switchingCore) throw new Error('另一个核心切换正在进行');
  if (activeCore?.version === descriptor.version) return coreStatus();
  switchingCore = true;
  coreUpdateError = '';
  rebuildTrayMenu();
  const previous = activeCore;
  let previousStopped = false;
  let candidate;
  let backupFile;
  gateway.showMaintenance({ targetVersion: descriptor.version, message: '正在等待已有查询完成并切换到新核心，请勿重复提交。' });
  try {
    await previous.module.prepareForCoreSwitch();
    await previous.module.shutdownServer(`core_switch:${reason}`);
    previousStopped = true;
    backupFile = coreManager.backupData(process.env.PPO_DATA_DIR, previous.version, descriptor.version);
    candidate = await importCore(descriptor);
    await coreHealth(candidate.port, descriptor.version);
    coreManager.activate(descriptor.version, previous.version);
    activeCore = { ...candidate, version: descriptor.version };
    serverModule = candidate.module;
    gateway.setTarget(candidate.port);
    availableCoreRelease = undefined;
    mainWindow?.webContents.reloadIgnoringCache();
    showUpdateNotice({ title: `核心已更新至 ${descriptor.version}`, body: '查询服务已完成无损切换，旧核心仍保留用于回滚。' });
    return coreStatus();
  } catch (error) {
    coreUpdateError = error.message;
    if (!previousStopped) {
      previous.module.cancelCoreSwitch?.();
      gateway.setTarget(previous.port);
      throw new Error(coreUpdateError);
    }
    try {
      await candidate?.module.shutdownServer('failed_core_health_check');
      coreManager.restoreDataBackup(backupFile, process.env.PPO_DATA_DIR);
      const fallbackDescriptor = previous?.descriptor || coreManager.rollbackDescriptor(descriptor.version);
      const fallback = await importCore(fallbackDescriptor);
      await coreHealth(fallback.port, fallbackDescriptor.version);
      coreManager.markFailed(descriptor.version, error.message, fallbackDescriptor.version);
      activeCore = { ...fallback, version: fallbackDescriptor.version };
      serverModule = fallback.module;
      gateway.setTarget(fallback.port);
    } catch (rollbackError) {
      coreUpdateError = `${error.message}；自动回滚失败：${rollbackError.message}`;
      gateway.showMaintenance({ targetVersion: descriptor.version, message: '核心更新和自动回滚均未成功，请从托盘退出后重新启动程序。' });
    }
    throw new Error(coreUpdateError);
  } finally {
    switchingCore = false;
    rebuildTrayMenu();
  }
}

async function checkCoreUpdates({ interactive = true } = {}) {
  if (checkingCoreUpdate || switchingCore) return coreStatus();
  checkingCoreUpdate = true;
  coreUpdateError = '';
  rebuildTrayMenu();
  try {
    const release = await coreManager.checkLatest();
    availableCoreRelease = release && compareVersions(release.version, activeCore.version) > 0 ? release : undefined;
    const message = availableCoreRelease
      ? `发现新查询核心 ${release.version}`
      : `当前核心 ${activeCore.version} 已是最新版本`;
    if (interactive) showUpdateNotice({
      title: availableCoreRelease ? `发现新查询核心 ${release.version}` : '查询核心已是最新版本',
      body: availableCoreRelease ? '可从托盘选择“下载并平滑更新”，查询服务不会丢失已有任务。' : `当前核心 ${activeCore.version}`,
      url: availableCoreRelease ? release.releaseUrl : ''
    });
    return { ...coreStatus(), message };
  } catch (error) {
    coreUpdateError = error.message;
    if (interactive) showUpdateNotice({ title: '暂时无法检查核心更新', body: error.message });
    throw error;
  } finally {
    checkingCoreUpdate = false;
    rebuildTrayMenu();
  }
}

async function installAvailableCore() {
  if (switchingCore) return;
  try {
    const release = availableCoreRelease || await coreManager.checkLatest();
    if (!release || compareVersions(release.version, activeCore.version) <= 0) {
      showUpdateNotice({ title: '查询核心已是最新版本', body: `当前核心 ${activeCore.version}` });
      return;
    }
    checkingCoreUpdate = true;
    rebuildTrayMenu();
    const descriptor = await coreManager.downloadAndInstall(release);
    checkingCoreUpdate = false;
    await switchToCore(descriptor, { reason: 'downloaded_update' });
  } catch (error) {
    checkingCoreUpdate = false;
    coreUpdateError = error.message;
    showUpdateNotice({ title: '核心更新失败', body: error.message });
    rebuildTrayMenu();
  }
}

async function rollbackCore() {
  try {
    const descriptor = coreManager.rollbackDescriptor(activeCore.version);
    await switchToCore(descriptor, { reason: 'manual_rollback' });
  } catch (error) {
    showUpdateNotice({ title: '无法回滚查询核心', body: error.message });
  }
}

async function startRuntime() {
  if (gateway && activeCore) return;
  const userData = app.getPath('userData');
  process.env.PPO_DATA_DIR ||= path.join(userData, 'data');
  process.env.PPO_LOG_DIR ||= path.join(userData, 'logs');
  const publicHost = process.env.PPO_HOST || '0.0.0.0';
  const publicPort = Math.max(1, Number.parseInt(process.env.PPO_PORT || '17654', 10) || 17654);
  const publicAutoIncrement = !['0', 'false', 'off', 'no'].includes(String(process.env.PPO_PORT_AUTO_INCREMENT || 'true').toLowerCase());
  coreManager = new CoreManager({
    appRoot: app.getAppPath(), userData, shellVersion: app.getVersion(), repository: REPOSITORY,
    publicKeyPath: path.join(app.getAppPath(), 'assets', 'core-update-public.pem')
  });
  globalThis.__PPO_CORE_CONTROL__ = {
    status: () => coreStatus(),
    check: () => checkCoreUpdates({ interactive: false }),
    update: () => installAvailableCore(),
    rollback: () => rollbackCore()
  };
  gateway = new StableGateway({ host: publicHost, port: publicPort, autoIncrement: publicAutoIncrement });
  ({ port: boundPort } = await gateway.listen());
  const descriptor = coreManager.resolveActive();
  const started = await importCore(descriptor);
  await coreHealth(started.port, descriptor.version);
  activeCore = { ...started, version: descriptor.version };
  serverModule = started.module;
  gateway.setTarget(started.port);
  setTimeout(() => checkCoreUpdates({ interactive: false }).catch(() => {}), 30_000).unref?.();
}

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

function showUpdateNotice({ title, body, url = '' }) {
  // Native modal dialogs enter an AppKit runModal loop on macOS. Because the
  // local HTTP server shares Electron's main process, a hidden modal dialog can
  // stall every API and page request. Notifications remain fully non-blocking.
  if (!Notification.isSupported()) {
    const normalTooltip = `埃及车辆违章查询 · 端口 ${boundPort}`;
    if (tray && !tray.isDestroyed()) tray.setToolTip(`${title} · ${body}`.slice(0, 120));
    setTimeout(() => {
      if (tray && !tray.isDestroyed()) tray.setToolTip(normalTooltip);
    }, 10_000).unref?.();
    return;
  }
  updateNotification?.close();
  const notice = new Notification({ title, body, silent: false });
  updateNotification = notice;
  if (url) notice.on('click', () => shell.openExternal(url));
  notice.on('close', () => {
    if (updateNotification === notice) updateNotification = undefined;
  });
  notice.show();
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
      showUpdateNotice({
        title: `发现新版本 ${release.version}`,
        body: `当前版本 ${currentVersion}。点击通知打开 GitHub Release 下载页面。`,
        url: release.url
      });
    } else if (interactive) {
      showUpdateNotice({
        title: '检查更新',
        body: `当前已是最新版本 ${currentVersion}`
      });
    }
  } catch (error) {
    if (interactive) {
      showUpdateNotice({
        title: '暂时无法检查更新',
        body: `未能读取 GitHub 最新版本信息：${error.message}`
      });
    }
  } finally {
    checkingUpdate = false;
    rebuildTrayMenu();
  }
}

function trayMenuTemplate() {
  const visible = Boolean(mainWindow?.isVisible());
  const rollbackVersion = coreManager?.readState().previousVersion;
  return [
    { label: `埃及车辆违章查询  v${app.getVersion()}`, enabled: false },
    { label: boundPort ? `● 服务运行中 · 端口 ${boundPort}` : '○ 服务正在启动', enabled: false },
    { label: activeCore ? `● 查询核心 v${activeCore.version}${activeCore.descriptor?.embedded ? ' · 内置' : ' · 热更新'}` : '○ 查询核心正在启动', enabled: false },
    { type: 'separator' },
    { label: visible ? '隐藏主窗口' : '显示主窗口', click: () => (visible ? hideMainWindow() : showMainWindow()) },
    { label: '在默认浏览器打开用户页面', enabled: Boolean(boundPort), click: () => shell.openExternal(userUrl()) },
    { label: '在默认浏览器打开管理员页面', enabled: Boolean(boundPort), click: () => shell.openExternal(adminUrl()) },
    { label: '复制访问地址', enabled: Boolean(boundPort), click: () => clipboard.writeText(userUrl()) },
    { type: 'separator' },
    { label: app.isPackaged ? '开机自动启动' : '开机自动启动（打包版可用）', type: 'checkbox', checked: isLoginEnabled(), enabled: app.isPackaged, click: item => setLoginEnabled(item.checked) },
    { label: checkingUpdate ? '正在检查更新…' : '检查版本更新…', enabled: !checkingUpdate, click: () => checkForUpdates() },
    { label: checkingCoreUpdate ? '正在获取查询核心…' : '检查查询核心更新…', enabled: !checkingCoreUpdate && !switchingCore, click: () => checkCoreUpdates() },
    ...(availableCoreRelease ? [{ label: `下载并平滑更新到核心 v${availableCoreRelease.version}`, enabled: !switchingCore && !checkingCoreUpdate, click: () => installAvailableCore() }] : []),
    ...(rollbackVersion && rollbackVersion !== activeCore?.version ? [{ label: `回滚查询核心到 v${rollbackVersion}`, enabled: !switchingCore, click: () => rollbackCore() }] : []),
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
    await startRuntime();
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
  (async () => {
    await serverModule?.shutdownServer('desktop_quit');
    await gateway?.close();
  })().finally(() => app.quit());
});
