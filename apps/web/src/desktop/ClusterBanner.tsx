import { Link } from 'react-router-dom';
import { useI18n } from '../hooks/useI18n';
import { useClusterStatus } from './useClusterStatus';

/**
 * Admin pages (desktop): the backup is offline, a new backup must be chosen after a promotion, or
 * registering is paused by the network-split rule.
 */
export default function ClusterBanner() {
  const { t } = useI18n();
  const status = useClusterStatus();
  if (status.state.status !== 'ready') return null;
  const s = status.state.data;
  const notes: string[] = [];
  // 'waiting' (a few seconds after a connection or a start) is not an alarm.
  if (s.registerState === 'paused') notes.push(t('cluster.paused'));
  if (s.otherSystems.length > 0) {
    notes.push(t('cluster.otherSystem', { name: s.otherSystems.map((o) => o.name).join(', ') }));
  }
  if (s.backup && !s.backup.connected) notes.push(t('backup.offline'));
  if (s.needsBackup && !s.backup) notes.push(t('backup.chooseNew'));
  if (s.conflicts.length > 0)
    notes.push(t('backup.conflictsBanner', { count: s.conflicts.length }));
  const progress = s.backup?.connected ? s.backup.copyProgress : null;
  if (notes.length === 0 && progress === null) return null;
  if (notes.length === 0) {
    // The new backup's first copy: information, not an alarm.
    return (
      <p
        role="status"
        className="mb-4 rounded-md bg-info-soft p-3 font-semibold"
        data-testid="cluster-progress"
      >
        {t('backup.firstCopy', { name: s.backup!.name, percent: progress! })}
      </p>
    );
  }
  return (
    <div
      role="alert"
      className="mb-4 space-y-1 rounded-md bg-danger-soft p-3"
      data-testid="cluster-banner"
    >
      {notes.map((n) => (
        <p key={n} className="font-semibold text-danger">
          {n}
        </p>
      ))}
      <Link to="/admin/stations" className="inline-flex min-h-touch items-center underline">
        {t('backup.open')}
      </Link>
    </div>
  );
}
