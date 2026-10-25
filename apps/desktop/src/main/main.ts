/**
 * VICIMUS Serial Station - Electron main process.
 *  - One window with the existing UI (built with `vite --mode desktop`), locked down: no Node in
 *    the page, context isolation, sandbox, and every request that is not a local file is cancelled
 *    (the app makes no internet requests; all assets are bundled).
 *  - Server mode starts with Windows and keeps running in the system tray when the window closes.
 *  - Labels print silently on the printer chosen once for this computer.
 */
import { join } from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, session, Tray } from 'electron';
import { msg } from '../../../web/src/i18n/core';
import type { DesktopEvent } from '../../../web/src/desktop/bridge';
import type { OpName, WireResult } from '../../../web/src/desktop/protocol';
import { electronRuntimeDeps, loadConfig, saveConfig } from './config';
import { Runtime } from './runtime';

const APP_NAME = 'VICIMUS Serial Station';

// Testing aid: VICIMUS_PROFILE=<name> keeps settings (and the single-instance lock) in a separate
// folder, so a main computer and a station can run side by side on one PC.
const profile = process.env.VICIMUS_PROFILE?.replace(/[^\w-]/g, '');
if (profile) app.setPath('userData', join(app.getPath('appData'), `${APP_NAME} (${profile})`));
const startedHidden = process.argv.includes('--background');

let window: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;

// Created when the app is ready (it reads this computer's settings from the profile folder).
let runtime: Runtime | undefined;

const assetPath = (...p: string[]) => join(__dirname, '..', ...p);
const appIcon = () => nativeImage.createFromPath(assetPath('icon.png'));

function createWindow() {
  window = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 900,
    minHeight: 640,
    show: false,
    title: APP_NAME,
    icon: appIcon(),
    autoHideMenuBar: true,
    webPreferences: {
      preload: assetPath('main', 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  Menu.setApplicationMenu(null);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://')) e.preventDefault();
  });
  void window.loadFile(assetPath('renderer', 'index.html'));
  window.once('ready-to-show', () => {
    if (!(startedHidden && runtime?.mode === 'server')) window?.show();
  });
  // Server: closing the window keeps the server running in the tray.
  window.on('close', (e) => {
    if (runtime?.mode === 'server' && !quitting) {
      e.preventDefault();
      window?.hide();
    }
  });
  window.on('closed', () => (window = null));
}

function showWindow() {
  if (!window) createWindow();
  window?.show();
  window?.focus();
}

function setupServerExtras() {
  // Start with Windows, quietly, in the tray.
  app.setLoginItemSettings({ openAtLogin: true, args: ['--background'] });
  if (tray) return;
  tray = new Tray(appIcon().resize({ width: 16, height: 16 }));
  tray.setToolTip(`${APP_NAME} (main computer)`);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open', click: showWindow },
      { type: 'separator' },
      {
        label: 'Quit (stations will stop working)',
        click: async () => {
          const { response } = await dialog.showMessageBox({
            type: 'warning',
            buttons: ['Keep running', 'Quit'],
            defaultId: 0,
            cancelId: 0,
            message: 'Quit the main computer?',
            detail: 'While it is closed, no station can check or register serials.',
          });
          if (response === 1) {
            quitting = true;
            app.quit();
          }
        },
      },
    ]),
  );
  tray.on('double-click', showWindow);
}

function registerIpc(rt: Runtime) {
  ipcMain.handle('desktop:info', () => rt.info());
  ipcMain.handle('desktop:signedIn', () => rt.signedIn());
  ipcMain.handle('desktop:call', (_e, op: OpName, input: unknown) => rt.call(op, input as never));
  ipcMain.handle('desktop:setupServer', async (_e, admin) => {
    const r = await rt.setupServer(admin);
    if (r.ok) setupServerExtras();
    return r;
  });
  ipcMain.handle('desktop:startDiscovery', () => rt.startDiscovery());
  ipcMain.handle('desktop:stopDiscovery', () => rt.stopDiscovery());
  ipcMain.handle('desktop:pairStation', (_e, input) => rt.pairStation(input));
  ipcMain.handle('desktop:resetPairing', () => rt.resetPairing());
  ipcMain.handle('desktop:promote', async (_e, input) => {
    const r = await rt.promote(input);
    if (r.ok) setupServerExtras(); // now the main computer: keeps running in the tray
    return r;
  });
  ipcMain.handle('desktop:handover', (_e, input) => rt.handover(input));

  ipcMain.handle('desktop:listPrinters', async (e) =>
    (await e.sender.getPrintersAsync()).map((p) => p.name).sort((a, b) => a.localeCompare(b)),
  );
  ipcMain.handle('desktop:getPrinter', () => loadConfig().printer);
  ipcMain.handle('desktop:setPrinter', (_e, name: string) => {
    saveConfig({ ...loadConfig(), printer: String(name) });
  });
  ipcMain.handle(
    'desktop:printLabel',
    (e, size: { width: number; height: number }): Promise<WireResult<null>> => {
      const printer = loadConfig().printer;
      if (!printer) {
        const m = msg('print.noPrinter');
        return Promise.resolve({
          ok: false,
          error: { code: 'invalid-data', message: 'No printer chosen', msg: m },
        });
      }
      const width = Math.round(Number(size.width) * 1000); // microns
      const height = Math.round(Number(size.height) * 1000);
      return new Promise((resolve) => {
        // Silent: no dialog. The print stylesheet shows only the label; no margins, headers or footers.
        e.sender.print(
          {
            silent: true,
            deviceName: printer,
            printBackground: true,
            color: false,
            margins: { marginType: 'none' },
            pageSize: { width, height },
            landscape: false,
            copies: 1,
          },
          (success, failureReason) =>
            resolve(
              success
                ? { ok: true, data: null }
                : {
                    ok: false,
                    error: {
                      code: 'unknown',
                      message: failureReason || 'Print failed',
                      msg: msg('print.failed'),
                    },
                  },
            ),
        );
      });
    },
  );
}

/** No internet: the page may load only its own bundled files. */
function blockNetwork() {
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const allowed = /^(file|devtools|data|blob):/.test(details.url);
    callback({ cancel: !allowed });
  });
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) =>
    callback(false),
  );
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);
  app.on('before-quit', () => (quitting = true));
  app.whenReady().then(async () => {
    app.setAppUserModelId('com.vicimus.serialstation');
    console.log(
      `[app] settings folder: ${app.getPath('userData')}${profile ? ` (profile "${profile}")` : ''}`,
    );
    runtime = new Runtime(
      app.getVersion(),
      (event: DesktopEvent) => window?.webContents.send('desktop:event', event),
      electronRuntimeDeps(),
    );
    blockNetwork();
    registerIpc(runtime);
    try {
      await runtime.start();
    } catch (e) {
      dialog.showErrorBox(APP_NAME, `The app could not start: ${(e as Error).message}`);
    }
    // The main computer and the backup keep running in the tray (the backup is copying data).
    if (runtime?.mode === 'server' || runtime?.info().role === 'backup') setupServerExtras();
    createWindow();
  });
  app.on('window-all-closed', () => {
    if (runtime?.mode !== 'server' && runtime?.info().role !== 'backup') app.quit();
  });
  app.on('will-quit', (e) => {
    e.preventDefault();
    void (runtime ? runtime.stop() : Promise.resolve()).finally(() => app.exit(0));
  });
}
