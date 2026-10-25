/**
 * Exposes `window.desktop` (see src/desktop/bridge.ts) to the page. Only these calls exist: the
 * page gets no Node, no Electron, no file system, and never sees credentials or session tokens.
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { DesktopBridge, DesktopEvent } from '../../../web/src/desktop/bridge';

const invoke = (channel: string, ...args: unknown[]) =>
  ipcRenderer.invoke(`desktop:${channel}`, ...args);

const bridge: DesktopBridge = {
  info: () => invoke('info'),
  on(listener) {
    const handler = (_e: IpcRendererEvent, event: DesktopEvent) => listener(event);
    ipcRenderer.on('desktop:event', handler);
    return () => ipcRenderer.removeListener('desktop:event', handler);
  },
  setupServer: (admin) => invoke('setupServer', admin),
  startDiscovery: () => invoke('startDiscovery'),
  stopDiscovery: () => invoke('stopDiscovery'),
  pairStation: (input) => invoke('pairStation', input),
  resetPairing: () => invoke('resetPairing'),
  promote: (input) => invoke('promote', input),
  handover: (input) => invoke('handover', input),
  call: (op, input) => invoke('call', op, input),
  signedIn: () => invoke('signedIn'),
  listPrinters: () => invoke('listPrinters'),
  getPrinter: () => invoke('getPrinter'),
  setPrinter: (name) => invoke('setPrinter', name),
  printLabel: (sizeMm) => invoke('printLabel', sizeMm),
};

contextBridge.exposeInMainWorld('desktop', bridge);
