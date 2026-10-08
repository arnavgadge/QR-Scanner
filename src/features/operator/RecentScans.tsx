import { ErrorNotice } from '../../components/common/ErrorNotice';
import { LoadingState } from '../../components/common/LoadingState';
import type { RecentScansController } from '../../hooks/useRecentScans';
import type { ScanLog } from '../../types';
import { formatDateTime } from '../../utils/format';

function ResultBadge({ result }: { result: ScanLog['result'] }) {
  return result === 'duplicate' ? (
    <span className="rounded bg-danger-soft px-2 py-0.5 text-sm font-bold text-danger">
      DUPLICATE
    </span>
  ) : (
    <span className="rounded bg-success-soft px-2 py-0.5 text-sm font-bold text-success">NEW</span>
  );
}

/** Presentational: the owning page runs the (limited) query and can refresh it after a scan. */
export function RecentScans({ recent }: { recent: RecentScansController }) {
  const { state, reload } = recent;

  return (
    <section aria-labelledby="recent-title" className="mt-10">
      <h2 id="recent-title" className="mb-3 text-xl font-bold">
        Recent scans
      </h2>
      {state.status === 'loading' && <LoadingState label="Loading recent scans…" />}
      {state.status === 'error' && <ErrorNotice message={state.message} onRetry={reload} />}
      {state.status === 'ready' && state.scans.length === 0 && (
        <p className="text-ink-muted">No recent scans.</p>
      )}
      {state.status === 'ready' && state.scans.length > 0 && (
        <>
          {/* Desktop table */}
          <div className="hidden overflow-x-auto rounded-lg border border-line bg-surface md:block">
            <table className="w-full text-left">
              <thead className="bg-info-soft text-sm">
                <tr>
                  <th scope="col" className="px-3 py-2">
                    Time
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Serial
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Result
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Company
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Operator
                  </th>
                </tr>
              </thead>
              <tbody>
                {state.scans.map((s) => (
                  <tr key={s.id} className="border-t border-line">
                    <td className="px-3 py-2 whitespace-nowrap">{formatDateTime(s.timestamp)}</td>
                    <td className="px-3 py-2 font-mono">{s.serial}</td>
                    <td className="px-3 py-2">
                      <ResultBadge result={s.result} />
                    </td>
                    <td className="px-3 py-2">{s.company}</td>
                    <td className="px-3 py-2">{s.scannedByName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Mobile list */}
          <ul className="space-y-2 md:hidden">
            {state.scans.map((s) => (
              <li key={s.id} className="rounded-lg border border-line bg-surface p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono font-bold break-all">{s.serial}</span>
                  <ResultBadge result={s.result} />
                </div>
                <p className="mt-1 text-sm text-ink-muted">
                  {s.company} · {s.scannedByName}
                </p>
                <p className="text-sm text-ink-muted">{formatDateTime(s.timestamp)}</p>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
