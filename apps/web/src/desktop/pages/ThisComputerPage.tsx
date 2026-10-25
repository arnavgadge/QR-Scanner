import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { useConnection } from '../../hooks/useConnection';
import { useI18n } from '../../hooks/useI18n';
import type { MessageKey } from '../../i18n';
import { recordedBy } from '../../features/stations/recordedBy';
import { desktopBridge, type DesktopInfo } from '../bridge';
import { useStationProfile } from '../useStationProfile';

const CONNECTION: Record<string, MessageKey> = {
  online: 'status.online',
  connecting: 'status.connecting',
  offline: 'status.offline',
  'update-required': 'status.updateRequired',
  revoked: 'status.revoked',
};

/** Any signed-in person: this computer's label printer, link to the main computer, Advanced. */
export default function ThisComputerPage() {
  const { t, dateTime } = useI18n();
  const connection = useConnection();
  // Name and usual operator live on the main computer (an administrator can change them).
  const { profile } = useStationProfile();
  const [info, setInfo] = useState<DesktopInfo | null>(null);
  const [printers, setPrinters] = useState<string[]>([]);
  const [printer, setPrinter] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const bridge = desktopBridge();
    if (!bridge) return;
    void bridge.info().then(setInfo);
    void bridge.listPrinters().then(setPrinters);
    void bridge.getPrinter().then((p) => setPrinter(p ?? ''));
    // Backup role and copy state change while the page is open.
    return bridge.on((e) => {
      if (e.type === 'cluster') void bridge.info().then(setInfo);
    });
  }, [connection]);

  const choose = async (name: string) => {
    setPrinter(name);
    setSaved(false);
    if (name) {
      await desktopBridge()?.setPrinter(name);
      setSaved(true);
    }
  };

  const pairAgain = async () => {
    await desktopBridge()?.resetPairing();
    window.location.reload();
  };

  return (
    <section aria-labelledby="page-title" className="max-w-2xl space-y-6">
      <h1 id="page-title" className="text-2xl font-bold sm:text-3xl">
        {t('settings.title')}
      </h1>

      <dl className="grid gap-2 rounded-lg border border-line bg-surface p-4 sm:grid-cols-[12rem_1fr]">
        <dt className="text-ink-muted">{t('settings.mode')}</dt>
        <dd className="font-semibold">
          {info?.mode === 'server' ? t('setup.server') : t('setup.node')}
        </dd>
        <dt className="text-ink-muted">{t('settings.stationName')}</dt>
        <dd className="font-semibold" data-testid="this-station-name">
          {profile ? recordedBy(t, profile.name, profile.operatorName) : '—'}
        </dd>
        <dt className="text-ink-muted">{t('settings.connection')}</dt>
        <dd
          className={
            connection === 'online' ? 'font-semibold text-success' : 'font-semibold text-danger'
          }
          data-testid="this-connection"
        >
          {t(CONNECTION[connection] ?? 'status.connecting')}
        </dd>
      </dl>

      {info?.role === 'backup' && info.backupCopy && (
        <section
          aria-labelledby="backup-title"
          className="space-y-3 rounded-lg border-2 border-info bg-info-soft p-4"
          data-testid="this-backup"
        >
          <h2 id="backup-title" className="text-lg font-bold">
            {t('backup.thisIsBackup')}
          </h2>
          <p>{t('backup.thisIsBackupHelp')}</p>
          <p className="font-semibold">
            {info.backupCopy.copyProgress !== null ? (
              t('backup.receivingFirst', { percent: info.backupCopy.copyProgress })
            ) : (
              <>
                {info.backupCopy.receiving ? t('backup.receiving') : t('backup.notReceiving')}
                {' · '}
                {t('backup.lastCopied', {
                  time: info.backupCopy.lastCopiedAt
                    ? dateTime(info.backupCopy.lastCopiedAt)
                    : t('promote.never'),
                })}
              </>
            )}
          </p>
          <Link
            to="/promote"
            className="inline-flex min-h-14 items-center justify-center rounded-md bg-danger px-5 text-lg font-semibold text-on-accent"
            data-testid="open-promote"
          >
            {t('promote.button')}
          </Link>
        </section>
      )}

      {connection === 'revoked' && (
        <Button onClick={() => void pairAgain()} className="min-h-14 text-lg">
          {t('settings.repair')}
        </Button>
      )}

      <div>
        <label htmlFor="label-printer" className="block text-sm font-semibold">
          {t('settings.printer')}
        </label>
        <select
          id="label-printer"
          data-testid="printer-select"
          value={printer}
          onChange={(e) => void choose(e.target.value)}
          className="mt-1 min-h-14 w-full rounded-md border border-line bg-surface px-3 text-lg"
        >
          <option value="">{t('settings.noPrinter')}</option>
          {printers.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <p className="mt-1 text-sm text-ink-muted">{t('settings.printerHelp')}</p>
        {saved && (
          <p role="status" className="mt-1 font-semibold text-success">
            {t('settings.printerSaved')}
          </p>
        )}
      </div>

      {info && (
        <details className="rounded-lg border border-line bg-surface p-3">
          <summary className="cursor-pointer font-semibold">{t('stations.advanced')}</summary>
          <dl className="mt-2 grid gap-1 text-sm sm:grid-cols-[12rem_1fr]">
            <dt className="text-ink-muted">{t('stations.address')}</dt>
            <dd className="font-mono">
              {info.mode === 'server'
                ? info.lanAddresses.join(', ') || '—'
                : (info.serverAddress ?? '—')}
            </dd>
            <dt className="text-ink-muted">{t('stations.serverId')}</dt>
            <dd className="font-mono break-all">{info.serverId ?? '—'}</dd>
            {info.dbFile && (
              <>
                <dt className="text-ink-muted">{t('stations.dataFile')}</dt>
                <dd className="font-mono break-all">{info.dbFile}</dd>
              </>
            )}
            <dt className="text-ink-muted">{t('settings.appVersion')}</dt>
            <dd className="font-mono">{info.appVersion}</dd>
          </dl>
        </details>
      )}
    </section>
  );
}
