import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { compareVersions } from './release-update.js';

const MAX_CORE_ARCHIVE_BYTES = 30 * 1024 * 1024;
const MAX_CORE_FILES = 500;
const MAX_CORE_UNPACKED_BYTES = 80 * 1024 * 1024;

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function unsignedManifest(manifest) {
  const { signature, ...payload } = manifest;
  return payload;
}

function safeVersion(version) {
  const value = String(version || '').replace(/^core-v/i, '').replace(/^v/i, '');
  if (!/^\d+\.\d+\.\d+$/.test(value)) throw new Error(`核心版本号无效：${version}`);
  return value;
}

function isSafeEntry(name) {
  if (!name || name.includes('\\') || name.startsWith('/') || /^[A-Za-z]:/.test(name)) return false;
  const normalized = path.posix.normalize(name);
  return normalized === name.replace(/\/$/, '') || `${normalized}/` === name;
}

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, file);
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

export class CoreManager {
  constructor({ appRoot, userData, shellVersion, repository, publicKeyPath, fetchImpl = globalThis.fetch } = {}) {
    this.appRoot = path.resolve(appRoot);
    this.shellVersion = safeVersion(shellVersion);
    this.repository = repository;
    this.fetchImpl = fetchImpl;
    this.root = path.join(path.resolve(userData), 'core-runtime');
    this.versionsDir = path.join(this.root, 'versions');
    this.stateFile = path.join(this.root, 'state.json');
    this.publicKeyPath = publicKeyPath;
    fs.mkdirSync(this.versionsDir, { recursive: true });
    const embeddedVersionFile = path.join(this.appRoot, 'core-version.json');
    this.embeddedVersion = fs.existsSync(embeddedVersionFile)
      ? safeVersion(JSON.parse(fs.readFileSync(embeddedVersionFile, 'utf8')).version)
      : this.shellVersion;
  }

  readState() {
    try {
      const value = JSON.parse(fs.readFileSync(this.stateFile, 'utf8'));
      return {
        activeVersion: value.activeVersion || this.embeddedVersion,
        previousVersion: value.previousVersion || null,
        lastKnownGoodVersion: value.lastKnownGoodVersion || this.embeddedVersion,
        failedVersions: value.failedVersions || {},
        updatedAt: value.updatedAt || null
      };
    } catch {
      return { activeVersion: this.embeddedVersion, previousVersion: null, lastKnownGoodVersion: this.embeddedVersion, failedVersions: {}, updatedAt: null };
    }
  }

  writeState(patch) {
    const value = { ...this.readState(), ...patch, updatedAt: new Date().toISOString() };
    writeJsonAtomic(this.stateFile, value);
    return value;
  }

  embeddedDescriptor() {
    return { version: this.embeddedVersion, root: this.appRoot, embedded: true, manifest: null };
  }

  descriptor(version) {
    const normalized = safeVersion(version);
    if (normalized === this.embeddedVersion) return this.embeddedDescriptor();
    const root = path.join(this.versionsDir, normalized);
    const manifestFile = path.join(root, 'core-manifest.json');
    if (!fs.existsSync(manifestFile)) throw new Error(`核心 ${normalized} 尚未安装`);
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    this.verifyManifest(manifest);
    this.verifyExtracted(root, manifest);
    return { version: normalized, root, embedded: false, manifest };
  }

  resolveActive() {
    const state = this.readState();
    try { return this.descriptor(state.activeVersion); }
    catch (error) {
      this.writeState({
        activeVersion: this.embeddedVersion,
        previousVersion: state.activeVersion,
        failedVersions: { ...state.failedVersions, [state.activeVersion]: { at: new Date().toISOString(), reason: error.message } }
      });
      return this.embeddedDescriptor();
    }
  }

  status(currentVersion = '') {
    const state = this.readState();
    return {
      shellVersion: this.shellVersion,
      embeddedVersion: this.embeddedVersion,
      activeVersion: currentVersion || state.activeVersion,
      previousVersion: state.previousVersion,
      lastKnownGoodVersion: state.lastKnownGoodVersion,
      installedVersions: this.installedVersions(),
      failedVersions: state.failedVersions
    };
  }

  installedVersions() {
    const versions = fs.readdirSync(this.versionsDir, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && /^\d+\.\d+\.\d+$/.test(entry.name))
      .map(entry => entry.name);
    return [...new Set([this.embeddedVersion, ...versions])].sort((left, right) => compareVersions(right, left));
  }

  verifyManifest(manifest) {
    if (manifest?.schemaVersion !== 1) throw new Error('不支持的核心包格式');
    const version = safeVersion(manifest.version);
    if (!Array.isArray(manifest.files) || !manifest.files.length || manifest.files.length > MAX_CORE_FILES) throw new Error('核心文件清单无效');
    if (manifest.minShellVersion && compareVersions(this.shellVersion, manifest.minShellVersion) < 0) throw new Error(`核心 ${version} 要求外壳 ${manifest.minShellVersion} 或更高版本`);
    if (manifest.maxShellVersion && compareVersions(this.shellVersion, manifest.maxShellVersion) > 0) throw new Error(`核心 ${version} 不兼容当前外壳 ${this.shellVersion}`);
    if (!fs.existsSync(this.publicKeyPath)) throw new Error('缺少核心更新验签公钥');
    const verified = crypto.verify(
      null,
      Buffer.from(canonicalJson(unsignedManifest(manifest))),
      fs.readFileSync(this.publicKeyPath),
      Buffer.from(String(manifest.signature || ''), 'base64')
    );
    if (!verified) throw new Error('核心包数字签名验证失败');
    return version;
  }

  inspectArchive(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 100 || buffer.length > MAX_CORE_ARCHIVE_BYTES) throw new Error('核心包大小异常');
    const zip = new AdmZip(buffer);
    const entries = zip.getEntries();
    if (!entries.length || entries.length > MAX_CORE_FILES + 20) throw new Error('核心包文件数量异常');
    let unpackedBytes = 0;
    const entryMap = new Map();
    for (const entry of entries) {
      const name = entry.entryName.replace(/\/$/, '');
      if (!entry.isDirectory && (!isSafeEntry(name) || name.split('/').includes('..'))) throw new Error(`核心包包含不安全路径：${entry.entryName}`);
      const unixMode = (entry.header.attr >>> 16) & 0xffff;
      if ((unixMode & 0o170000) === 0o120000) throw new Error(`核心包不允许符号链接：${entry.entryName}`);
      if (!entry.isDirectory) {
        unpackedBytes += entry.header.size;
        if (entryMap.has(name)) throw new Error(`核心包包含重复路径：${name}`);
        entryMap.set(name, entry);
      }
    }
    if (unpackedBytes > MAX_CORE_UNPACKED_BYTES) throw new Error('核心包解压后体积超过限制');
    const manifestEntry = entryMap.get('core-manifest.json');
    if (!manifestEntry) throw new Error('核心包缺少 core-manifest.json');
    const manifest = JSON.parse(manifestEntry.getData().toString('utf8'));
    const version = this.verifyManifest(manifest);
    const declared = new Set(manifest.files.map(file => file.path));
    if (declared.size !== manifest.files.length) throw new Error('核心包文件清单包含重复路径');
    const actual = new Set([...entryMap.keys()].filter(name => name !== 'core-manifest.json'));
    if (declared.size !== actual.size || [...declared].some(name => !actual.has(name))) throw new Error('核心包内容与签名文件清单不一致');
    for (const file of manifest.files) {
      if (!isSafeEntry(file.path) || !/^[a-f0-9]{64}$/.test(file.sha256)) throw new Error('核心包文件摘要无效');
      const entry = entryMap.get(file.path);
      if (!entry || sha256(entry.getData()) !== file.sha256) throw new Error(`核心文件校验失败：${file.path}`);
    }
    return { zip, manifest, version };
  }

  verifyExtracted(root, manifest) {
    for (const file of manifest.files) {
      const absolute = path.resolve(root, file.path);
      if (!absolute.startsWith(`${path.resolve(root)}${path.sep}`) || !fs.statSync(absolute).isFile()) throw new Error(`核心文件缺失：${file.path}`);
      if (sha256(fs.readFileSync(absolute)) !== file.sha256) throw new Error(`已安装核心文件校验失败：${file.path}`);
    }
    return true;
  }

  installArchive(buffer) {
    const { zip, manifest, version } = this.inspectArchive(buffer);
    const target = path.join(this.versionsDir, version);
    const staging = path.join(this.versionsDir, `.staging-${version}-${crypto.randomUUID()}`);
    fs.mkdirSync(staging, { recursive: true });
    let replaced = '';
    try {
      zip.extractAllTo(staging, true, false);
      this.verifyExtracted(staging, manifest);
      if (fs.existsSync(target)) {
        replaced = `${target}.replaced-${Date.now()}`;
        fs.renameSync(target, replaced);
      }
      fs.renameSync(staging, target);
      if (replaced) fs.rmSync(replaced, { recursive: true, force: true });
      return this.descriptor(version);
    } catch (error) {
      fs.rmSync(staging, { recursive: true, force: true });
      if (replaced && fs.existsSync(replaced) && !fs.existsSync(target)) fs.renameSync(replaced, target);
      throw error;
    }
  }

  async checkLatest() {
    const endpoint = `https://api.github.com/repos/${this.repository}/releases?per_page=30`;
    const response = await this.fetchImpl(endpoint, {
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'ppo-query-hub-core-updater', 'x-github-api-version': '2022-11-28' },
      signal: AbortSignal.timeout(12_000)
    });
    if (!response.ok) throw new Error(`核心更新服务器返回 HTTP ${response.status}`);
    let releases;
    try {
      releases = await response.json();
    } catch {
      const contentType = response.headers?.get?.('content-type') || 'unknown';
      throw new Error(`核心更新服务器返回了无法识别的内容（${contentType}），可能被网络代理或登录页面拦截`);
    }
    if (!Array.isArray(releases)) throw new Error('核心更新服务器返回的数据格式不正确');
    const candidates = [];
    for (const release of releases) {
      if (release.draft || release.prerelease) continue;
      for (const asset of release.assets || []) {
        if (!/^ppo-query-core-v\d+\.\d+\.\d+\.zip$/.test(asset.name)) continue;
        const version = safeVersion(asset.name.match(/v(\d+\.\d+\.\d+)\.zip$/)?.[1]);
        candidates.push({ version, url: asset.browser_download_url, releaseUrl: release.html_url, size: asset.size || null });
      }
    }
    candidates.sort((left, right) => compareVersions(right.version, left.version));
    if (candidates.length) return candidates[0];
    return null;
  }

  async downloadAndInstall(release) {
    if (!release) throw new Error('当前没有可下载的查询核心更新');
    const response = await this.fetchImpl(release.url, {
      headers: { accept: 'application/octet-stream', 'user-agent': 'ppo-query-hub-core-updater' },
      signal: AbortSignal.timeout(120_000), redirect: 'follow'
    });
    if (!response.ok) throw new Error(`核心包下载失败：HTTP ${response.status}`);
    const declaredLength = Number(response.headers?.get?.('content-length') || 0);
    if (declaredLength > MAX_CORE_ARCHIVE_BYTES) throw new Error('核心包超过允许的下载大小');
    const buffer = Buffer.from(await response.arrayBuffer());
    const descriptor = this.installArchive(buffer);
    if (descriptor.version !== safeVersion(release.version)) throw new Error('下载的核心版本与 Release 不一致');
    return descriptor;
  }

  activate(version, previousVersion) {
    const descriptor = this.descriptor(version);
    this.writeState({ activeVersion: descriptor.version, previousVersion: previousVersion || null, lastKnownGoodVersion: descriptor.version });
    this.cleanupVersions(3);
    return descriptor;
  }

  markFailed(version, reason, fallbackVersion) {
    const state = this.readState();
    this.writeState({
      activeVersion: fallbackVersion || this.embeddedVersion,
      failedVersions: { ...state.failedVersions, [version]: { at: new Date().toISOString(), reason: String(reason || 'health check failed') } }
    });
  }

  rollbackDescriptor(currentVersion) {
    const state = this.readState();
    const candidates = [state.previousVersion, state.lastKnownGoodVersion, this.embeddedVersion]
      .filter(version => version && version !== currentVersion);
    for (const version of candidates) {
      try { return this.descriptor(version); } catch {}
    }
    throw new Error('没有可回滚的核心版本');
  }

  backupData(dataDir, fromVersion, toVersion) {
    const source = path.join(path.resolve(dataDir), 'ppo-query-hub.sqlite');
    if (!fs.existsSync(source)) return null;
    const directory = path.join(this.root, 'backups');
    fs.mkdirSync(directory, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const target = path.join(directory, `${stamp}-${fromVersion}-to-${toVersion}.sqlite`);
    fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
    const backups = fs.readdirSync(directory).filter(name => name.endsWith('.sqlite')).sort().reverse();
    for (const name of backups.slice(5)) fs.rmSync(path.join(directory, name), { force: true });
    return target;
  }

  restoreDataBackup(backupFile, dataDir) {
    if (!backupFile || !fs.existsSync(backupFile)) return false;
    const directory = path.resolve(dataDir);
    const target = path.join(directory, 'ppo-query-hub.sqlite');
    if (!target.startsWith(`${directory}${path.sep}`)) throw new Error('数据库恢复路径无效');
    fs.copyFileSync(backupFile, target);
    for (const suffix of ['-wal', '-shm']) fs.rmSync(`${target}${suffix}`, { force: true });
    return true;
  }

  cleanupVersions(keep = 3) {
    const state = this.readState();
    const protectedVersions = new Set([state.activeVersion, state.previousVersion, state.lastKnownGoodVersion, this.embeddedVersion].filter(Boolean));
    const removable = this.installedVersions().filter(version => version !== this.embeddedVersion && !protectedVersions.has(version)).slice(keep);
    for (const version of removable) {
      const target = path.join(this.versionsDir, version);
      if (target.startsWith(`${this.versionsDir}${path.sep}`)) fs.rmSync(target, { recursive: true, force: true });
    }
  }
}
