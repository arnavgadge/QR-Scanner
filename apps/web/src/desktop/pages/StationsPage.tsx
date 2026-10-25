import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ErrorNotice } from '../../components/common/ErrorNotice';
import { LoadingState } from '../../components/common/LoadingState';
import { Button } from '../../components/ui/Button';
import { TextField } from '../../components/ui/TextField';
import { useAsyncData } from '../../hooks/useAsyncData';
import { useI18n } from '../../hooks/useI18n';
import { msg, type Text } from '../../i18n';
import { AppError, errorText, toAppError } from '../../services/errors';
import { desktopBridge, type DesktopInfo } from '../bridge';
import { BackupSection } from './BackupSection';
import { useClusterStatus } from '../useClusterStatus';
import type { OpIn, OpName, OpOut, PairedNode, PairingStatus } from '../protocol';

async function call<K extends OpName>(op: K, input: OpIn<K>): Promise<OpOut<K>> {
  const r = await desktopBridge()!.call(op, input);
  if (r.ok) return r.data;
  throw new AppError(r.error.code, r.error.msg ?? r.error.message);
}

/** Admin: stations (paired computers), adding one with the 6-digit code, sign-out hours. */
export default function StationsPage() {
  const { t } = useI18n();
  const [info, setInfo] = useState<DesktopInfo | null>(null);
  useEffect(() => {
    void desktopBridge()?.info().then(setInfo);
  }, []);
  const loader = useCallback(() => call('nodes.list', {}), []);
  const nodes = useAsyncData(loader, 'stations.loadFailed');
  const cluster = useClusterStatus();
  const backupNodeId =
    cluster.state.status === 'ready' ? (cluster.state.data.backup?.nodeId ?? null) : null;

  return (
    <section aria-labelledby="page-title" className="space-y-6">
      <div>
        <h1 id="page-title" className="text-2xl font-bold sm:text-3xl">
          {t('stations.title')}
        </h1>
        <p className="mt-2 max-w-2xl text-ink-muted">{t('stations.intro')}</p>
      </div>

      {info?.mode === 'server' ? (
        <AddStation onPaired={nodes.refresh} />
      ) : (
        <p className="rounded-md bg-info-soft px-3 py-2 text-sm text-info">
          {t('stations.serverOnly')}
        </p>
      )}

      {nodes.state.status === 'loading' && <LoadingState />}
      {nodes.state.status === 'error' && (
        <ErrorNotice message={nodes.state.message} onRetry={nodes.reload} />
      )}
      {nodes.state.status === 'ready' && (
        <StationList
          nodes={nodes.state.data}
          backupNodeId={backupNodeId}
          onChanged={() => {
            nodes.refresh();
            cluster.refresh();
          }}
        />
      )}
      {nodes.state.status === 'ready' && (
        <BackupSection nodes={nodes.state.data} isServer={info?.mode === 'server'} />
      )}

      <AdminIdle />

      {info && (
        <details
          className="rounded-lg border border-line bg-surface p-3"
          data-testid="stations-advanced"
        >
          <summary className="cursor-pointer font-semibold">{t('stations.advanced')}</summary>
          <dl className="mt-2 grid gap-1 text-sm sm:grid-cols-[12rem_1fr]">
            <dt className="text-ink-muted">{t('stations.serverId')}</dt>
            <dd className="font-mono break-all">{info.serverId ?? '—'}</dd>
            <dt className="text-ink-muted">{t('stations.address')}</dt>
            <dd className="font-mono">
              {info.mode === 'server'
                ? info.lanAddresses.join(', ') || '—'
                : (info.serverAddress ?? '—')}
            </dd>
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

function AddStation({ onPaired }: { onPaired: () => void }) {
  const { t, text } = useI18n();
  const [status, setStatus] = useState<PairingStatus | null>(null);
  const [error, setError] = useState<Text | null>(null);

  // While "Add station" is open: show the current code, refreshed every second.
  useEffect(() => {
    if (!status?.open) return;
    const timer = window.setInterval(() => {
      void call('pairing.status', {})
        .then((s) => {
          setStatus((prev) => {
            if (prev && prev.code !== s.code) onPaired(); // a station may just have paired
            return s;
          });
        })
        .catch(() => undefined);
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [status?.open, onPaired]);

  // Leaving the page closes pairing.
  useEffect(() => () => void call('pairing.close', {}).catch(() => undefined), []);

  const open = () =>
    call('pairing.open', {})
      .then((s) => (setError(null), setStatus(s)))
      .catch((e: unknown) => setError(errorText(toAppError(e))));
  const close = () => {
    void call('pairing.close', {}).catch(() => undefined);
    setStatus(null);
    onPaired();
  };

  if (!status?.open) {
    return (
      <div className="space-y-2">
        <Button onClick={() => void open()} className="min-h-14 text-lg" data-testid="stations-add">
          {t('stations.add')}
        </Button>
        {error && (
          <p role="alert" className="font-semibold text-danger">
            {text(error)}
          </p>
        )}
      </div>
    );
  }
  return (
    <div
      className="max-w-xl space-y-3 rounded-lg border-2 border-action bg-surface p-5"
      data-testid="pairing-panel"
    >
      <p>{t('stations.addHelp')}</p>
      {status.lockedUntil ? (
        <p role="alert" className="rounded-md bg-danger-soft p-3 font-semibold text-danger">
          {t('stations.lockedUntil', {
            time: new Date(status.lockedUntil).toLocaleTimeString(undefined, {
              numberingSystem: 'latn',
            }),
          })}
        </p>
      ) : (
        <>
          <p
            className="text-center font-mono text-6xl font-extrabold tracking-[0.3em] text-action"
            data-testid="pairing-code"
            aria-live="polite"
          >
            {status.code}
          </p>
          <p className="text-center text-sm text-ink-muted">
            {t('stations.codeChanges', { seconds: status.secondsLeft })}
          </p>
        </>
      )}
      <Button variant="secondary" onClick={close} className="w-full">
        {t('stations.done')}
      </Button>
    </div>
  );
}

function StationList({
  nodes,
  backupNodeId,
  onChanged,
}: {
  nodes: PairedNode[];
  /** The backup main computer (removing it is warned about). */
  backupNodeId: string | null;
  onChanged: () => void;
}) {
  const { t, text, dateTime } = useI18n();
  const [confirming, setConfirming] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: Text } | null>(null);

  const remove = async (node: PairedNode) => {
    try {
      await call('nodes.revoke', { nodeId: node.id });
      setMessage({
        ok: true,
        text:
          node.id === backupNodeId
            ? msg('stations.removedBackup', { name: node.name })
            : msg('stations.removed', { name: node.name }),
      });
      onChanged();
    } catch (e) {
      setMessage({ ok: false, text: errorText(toAppError(e)) });
    }
    setConfirming(null);
  };

  const saved = (name: string) => {
    setEditing(null);
    setMessage({ ok: true, text: msg('stations.updated', { name }) });
    onChanged();
  };

  if (nodes.length === 0) return <p className="text-ink-muted">{t('stations.empty')}</p>;
  return (
    <div className="space-y-3">
      <div aria-live="polite">
        {message && (
          <p
            role={message.ok ? 'status' : 'alert'}
            className={`rounded-md p-3 font-semibold ${message.ok ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger'}`}
          >
            {text(message.text)}
          </p>
        )}
      </div>
      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="w-full text-left" data-testid="stations-table">
          <thead className="bg-info-soft text-sm">
            <tr>
              {[
                t('stations.name'),
                t('stations.operator'),
                t('stations.paired'),
                t('stations.lastSeen'),
                t('stations.version'),
                '',
              ].map((h, i) => (
                <th key={h || i} scope="col" className="px-3 py-2">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {nodes.map((n) => (
              <tr key={n.id} className="border-t border-line align-top">
                <td className="px-3 py-2 font-semibold" colSpan={editing === n.id ? 2 : 1}>
                  {editing === n.id ? (
                    <EditStation node={n} onSaved={saved} onCancel={() => setEditing(null)} />
                  ) : (
                    <>
                      {n.name}
                      {n.isServer && (
                        <span className="ml-2 text-sm font-normal text-ink-muted">
                          ({t('stations.thisServer')})
                        </span>
                      )}
                      {!n.configured && (
                        <span className="ml-2 text-sm font-normal text-warn">
                          ({t('stations.notSetUp')})
                        </span>
                      )}
                    </>
                  )}
                </td>
                {editing !== n.id && <td className="px-3 py-2">{n.operatorName || '—'}</td>}
                <td className="px-3 py-2 text-sm whitespace-nowrap">{dateTime(n.pairedAt)}</td>
                <td className="px-3 py-2 text-sm whitespace-nowrap">{dateTime(n.lastSeen)}</td>
                <td className="px-3 py-2 font-mono text-sm">{n.appVersion}</td>
                <td className="px-3 py-2">
                  {confirming === n.id ? (
                    <div className="space-y-2">
                      {n.id === backupNodeId && (
                        <p
                          role="alert"
                          className="rounded-md bg-warn-soft p-2 text-sm font-semibold"
                          data-testid="remove-backup-warning"
                        >
                          {t('stations.removeBackupWarning')}
                        </p>
                      )}
                      <p className="text-sm font-semibold">
                        {t('stations.confirmRemove', { name: n.name })}
                      </p>
                      <div className="flex gap-2">
                        <Button variant="danger" onClick={() => void remove(n)}>
                          {t('common.yes')}
                        </Button>
                        <Button variant="secondary" onClick={() => setConfirming(null)}>
                          {t('common.no')}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    editing !== n.id && (
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="secondary"
                          onClick={() => {
                            setConfirming(null);
                            setEditing(n.id);
                          }}
                          data-testid={`station-edit-${n.id}`}
                        >
                          {t('common.edit')}
                        </Button>
                        {/* The main computer's own station can be renamed but never removed. */}
                        {!n.isServer && (
                          <Button
                            variant="secondary"
                            onClick={() => setConfirming(n.id)}
                            data-testid={`station-remove-${n.id}`}
                          >
                            {t('stations.remove')}
                          </Button>
                        )}
                      </div>
                    )
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AdminIdle() {
  const { t, text } = useI18n();
  const [minutes, setMinutes] = useState('');
  const [message, setMessage] = useState<{ ok: boolean; text: Text } | null>(null);
  useEffect(() => {
    void call('settings.get', {})
      .then((s) => setMinutes(String(s.adminIdleMinutes)))
      .catch(() => undefined);
  }, []);
  const save = async () => {
    try {
      await call('settings.set', { adminIdleMinutes: Number(minutes) });
      setMessage({ ok: true, text: msg('stations.saved') });
    } catch (e) {
      setMessage({ ok: false, text: errorText(toAppError(e)) });
    }
  };
  return (
    <div className="flex max-w-xl flex-wrap items-end gap-3">
      <div className="w-72">
        <TextField
          label={t('stations.adminIdle')}
          value={minutes}
          onChange={(e) => setMinutes(e.target.value.replace(/\D/g, '').slice(0, 3))}
          inputMode="numeric"
          data-testid="admin-idle-minutes"
        />
      </div>
      <Button variant="secondary" onClick={() => void save()} className="min-h-14">
        {t('stations.save')}
      </Button>
      {message && (
        <p
          role={message.ok ? 'status' : 'alert'}
          className={message.ok ? 'text-success' : 'font-semibold text-danger'}
        >
          {text(message.text)}
        </p>
      )}
    </div>
  );
}

/** Admin: a station's name (required) and usual operator (optional). */
function EditStation({
  node,
  onSaved,
  onCancel,
}: {
  node: PairedNode;
  onSaved: (name: string) => void;
  onCancel: () => void;
}) {
  const { t, text } = useI18n();
  const [name, setName] = useState(node.name);
  const [operatorName, setOperatorName] = useState(node.operatorName);
  const [error, setError] = useState<Text | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await call('nodes.update', { nodeId: node.id, name, operatorName });
      onSaved(name.trim());
    } catch (err) {
      setError(errorText(toAppError(err)));
      setBusy(false);
    }
  };
  return (
    <form onSubmit={(e) => void save(e)} noValidate className="grid gap-2 sm:grid-cols-2">
      <TextField
        label={t('stations.name')}
        value={name}
        onChange={(e) => setName(e.target.value)}
        disabled={busy}
        maxLength={60}
      />
      <TextField
        label={t('stations.operator')}
        value={operatorName}
        onChange={(e) => setOperatorName(e.target.value)}
        disabled={busy}
        maxLength={60}
      />
      {error && (
        <p role="alert" className="font-semibold text-danger sm:col-span-2">
          {text(error)}
        </p>
      )}
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" disabled={busy || !name.trim()}>
          {busy ? t('common.saving') : t('stations.save')}
        </Button>
        <Button variant="secondary" onClick={onCancel} disabled={busy}>
          {t('common.cancel')}
        </Button>
      </div>
    </form>
  );
}
