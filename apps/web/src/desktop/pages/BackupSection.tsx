import { useState } from 'react';
import { ErrorNotice } from '../../components/common/ErrorNotice';
import { LoadingState } from '../../components/common/LoadingState';
import { Button } from '../../components/ui/Button';
import { useI18n } from '../../hooks/useI18n';
import { msg, type Text } from '../../i18n';
import { errorText, toAppError } from '../../services/errors';
import { desktopCall } from '../call';
import type { PairedNode } from '../protocol';
import { RecoveryCodeNotice } from '../RecoveryCodeNotice';
import { useClusterStatus } from '../useClusterStatus';

/** Admin › Stations: the backup main computer, its state, and the recovery code. */
export function BackupSection({ nodes, isServer }: { nodes: PairedNode[]; isServer: boolean }) {
  const { t, text, dateTime } = useI18n();
  const status = useClusterStatus();
  const [choice, setChoice] = useState('');
  const [message, setMessage] = useState<{ ok: boolean; text: Text } | null>(null);
  const [busy, setBusy] = useState(false);
  const candidates = nodes.filter((n) => !n.isServer);

  const run = async (task: () => Promise<unknown>, ok?: Text) => {
    setBusy(true);
    setMessage(null);
    try {
      await task();
      if (ok) setMessage({ ok: true, text: ok });
      status.refresh();
    } catch (e) {
      setMessage({ ok: false, text: errorText(toAppError(e)) });
    } finally {
      setBusy(false);
    }
  };

  if (status.state.status === 'loading') return <LoadingState />;
  if (status.state.status === 'error') {
    return <ErrorNotice message={status.state.message} onRetry={status.reload} />;
  }
  const s = status.state.data;
  const current = s.backup;

  return (
    <section
      aria-labelledby="backup-heading"
      className="space-y-4 rounded-lg border border-line bg-surface p-4"
      data-testid="backup-section"
    >
      <h2 id="backup-heading" className="text-xl font-bold">
        {t('backup.title')}
      </h2>
      <p className="max-w-2xl text-ink-muted">{t('backup.intro')}</p>

      {s.otherSystems.length > 0 && (
        <p
          role="alert"
          className="rounded-md bg-danger-soft p-3 font-semibold text-danger"
          data-testid="other-system"
        >
          {t('cluster.otherSystem', { name: s.otherSystems.map((o) => o.name).join(', ') })}
        </p>
      )}
      {s.registerState === 'paused' && (
        <p
          role="alert"
          className="rounded-md bg-danger-soft p-3 font-semibold text-danger"
          data-testid="register-paused"
        >
          {t('cluster.paused')}{' '}
          {/* The stations only matter while the backup is not connected (it alone is enough). */}
          {!current?.connected &&
            s.otherStations > 0 &&
            t('backup.reach', { connected: s.connectedStations, total: s.otherStations })}
        </p>
      )}
      {s.registerState === 'waiting' && (
        <p role="status" className="rounded-md bg-info-soft p-3" data-testid="register-waiting">
          {t('cluster.waiting')}
        </p>
      )}
      {s.needsBackup && !current && (
        <p
          role="alert"
          className="rounded-md bg-warn-soft p-3 font-semibold"
          data-testid="needs-backup"
        >
          {t('backup.chooseNew')}
        </p>
      )}
      {current ? (
        <p
          className={`rounded-md p-3 font-semibold ${
            !current.connected
              ? 'bg-danger-soft text-danger'
              : current.copyProgress !== null
                ? 'bg-info-soft text-ink'
                : 'bg-success-soft text-success'
          }`}
          data-testid="backup-state"
        >
          {!current.connected
            ? `${t('backup.offline')} (${current.name})`
            : current.copyProgress !== null
              ? t('backup.firstCopy', { name: current.name, percent: current.copyProgress })
              : current.upToDate
                ? t('backup.upToDate', {
                    name: current.name,
                    time: current.lastCopiedAt
                      ? dateTime(current.lastCopiedAt)
                      : t('promote.never'),
                  })
                : t('backup.copying', {
                    name: current.name,
                    time: current.lastCopiedAt
                      ? dateTime(current.lastCopiedAt)
                      : t('promote.never'),
                  })}
        </p>
      ) : (
        !s.needsBackup && <p className="text-ink-muted">{t('backup.none')}</p>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <label className="block w-72 text-sm font-semibold">
          {current ? t('backup.moveTo') : t('backup.choose')}
          <select
            className="mt-1 min-h-14 w-full rounded-md border border-line bg-surface px-3 text-lg"
            value={choice}
            onChange={(e) => setChoice(e.target.value)}
            data-testid="backup-choice"
          >
            <option value="">{t('backup.pick')}</option>
            {candidates
              .filter((n) => n.id !== current?.nodeId)
              .map((n) => (
                <option key={n.id} value={n.id}>
                  {n.name}
                </option>
              ))}
          </select>
        </label>
        <Button
          variant="secondary"
          className="min-h-14"
          disabled={!choice || busy}
          onClick={() =>
            void run(
              () => desktopCall('cluster.setBackup', { nodeId: choice }),
              current ? msg('backup.moved') : msg('backup.set'),
            )
          }
        >
          {current ? t('backup.move') : t('backup.make')}
        </Button>
      </div>
      {current && <p className="text-sm text-ink-muted">{t('backup.moveHelp')}</p>}

      {s.conflicts.length > 0 && (
        <div className="space-y-2" data-testid="handover-conflicts">
          <h3 className="font-bold text-danger">{t('backup.conflictsTitle')}</h3>
          <p className="text-sm text-ink-muted">{t('backup.conflictsHelp')}</p>
          <div className="overflow-x-auto rounded-md border border-line">
            <table className="w-full text-left text-sm">
              <thead className="bg-info-soft">
                <tr>
                  {[
                    t('common.serial'),
                    t('common.company'),
                    t('backup.here'),
                    t('backup.former'),
                  ].map((h) => (
                    <th key={h} scope="col" className="px-2 py-1">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {s.conflicts.map((c) => (
                  <tr key={`${c.companyId}|${c.serial}`} className="border-t border-line">
                    <td className="px-2 py-1 font-mono">{c.serial}</td>
                    <td className="px-2 py-1">{c.company}</td>
                    <td className="px-2 py-1">
                      {t('backup.recordLine', {
                        part: c.partNo || '—',
                        station: c.nodeName,
                        time: dateTime(c.scannedAt),
                      })}
                    </td>
                    <td className="px-2 py-1">
                      {t('backup.recordLine', {
                        part: c.otherPartNo || '—',
                        station: c.otherNodeName,
                        time: dateTime(c.otherScannedAt),
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => void run(() => desktopCall('cluster.clearConflicts', {}))}
          >
            {t('backup.clearConflicts')}
          </Button>
        </div>
      )}

      {message && (
        <p
          role={message.ok ? 'status' : 'alert'}
          className={message.ok ? 'text-success' : 'font-semibold text-danger'}
        >
          {text(message.text)}
        </p>
      )}

      {isServer && <NewRecoveryCode />}
    </section>
  );
}

/** On the main computer itself: a new recovery code (the previous one stops working). */
function NewRecoveryCode() {
  const { t, text } = useI18n();
  const [code, setCode] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<Text | null>(null);
  if (code) return <RecoveryCodeNotice code={code} onDone={() => setCode(null)} />;
  return (
    <div className="space-y-2 border-t border-line pt-4">
      <h3 className="font-bold">{t('recovery.title')}</h3>
      <p className="text-sm text-ink-muted">{t('recovery.regenerateHelp')}</p>
      {confirming ? (
        <div className="flex flex-wrap gap-3">
          <Button
            variant="danger"
            onClick={() =>
              void desktopCall('recovery.regenerate', {})
                .then((r) => {
                  setConfirming(false);
                  setCode(r.recoveryCode);
                })
                .catch((e) => setError(errorText(toAppError(e))))
            }
          >
            {t('recovery.regenerateConfirm')}
          </Button>
          <Button variant="secondary" onClick={() => setConfirming(false)}>
            {t('common.cancel')}
          </Button>
        </div>
      ) : (
        <Button variant="secondary" onClick={() => setConfirming(true)}>
          {t('recovery.regenerate')}
        </Button>
      )}
      {error && (
        <p role="alert" className="font-semibold text-danger">
          {text(error)}
        </p>
      )}
    </div>
  );
}
