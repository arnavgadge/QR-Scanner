/**
 * This computer's settings on disk, in <userData>/config.json (Windows: %APPDATA%\VICIMUS Serial
 * Station). The station credential is encrypted with Electron safeStorage (Windows DPAPI: readable
 * only by this Windows user on this computer). The server's database is NOT here: see
 * serverDataDir().
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app, safeStorage } from 'electron';
import { EMPTY_CONFIG, type RuntimeDeps, type StoredConfig } from './configModel';

const file = () => join(app.getPath('userData'), 'config.json');

/** Where the server keeps its single database file (serials.db) and its TLS certificate. */
export function serverDataDir(): string {
  return join(app.getPath('userData'), 'server');
}

export function loadConfig(): StoredConfig {
  try {
    if (!existsSync(file())) return { ...EMPTY_CONFIG };
    return {
      ...EMPTY_CONFIG,
      ...(JSON.parse(readFileSync(file(), 'utf8')) as Partial<StoredConfig>),
    };
  } catch {
    return { ...EMPTY_CONFIG };
  }
}

export function saveConfig(config: StoredConfig): void {
  mkdirSync(app.getPath('userData'), { recursive: true });
  const tmp = `${file()}.tmp`;
  writeFileSync(tmp, JSON.stringify(config, null, 2), { mode: 0o600 });
  renameSync(tmp, file()); // atomic replace: never a half-written config
}

function protect(token: string): string {
  return safeStorage.isEncryptionAvailable()
    ? `enc:${safeStorage.encryptString(token).toString('base64')}`
    : `plain:${token}`;
}

function reveal(stored: string): string {
  if (stored.startsWith('enc:')) {
    return safeStorage.decryptString(Buffer.from(stored.slice(4), 'base64'));
  }
  return stored.replace(/^plain:/, '');
}

/** The runtime's dependencies in the real app. */
export function electronRuntimeDeps(): RuntimeDeps {
  return { loadConfig, saveConfig, serverDataDir: serverDataDir(), protect, reveal };
}
