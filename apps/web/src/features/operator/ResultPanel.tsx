import type { ReactNode, RefObject } from 'react';
import { Button } from '../../components/ui/Button';
import { useI18n } from '../../hooks/useI18n';
import { codeTypeKey } from '../companies/codeTypeLabel';
import { recordedBy } from '../stations/recordedBy';
import { dataService } from '../../data';
import { LabelPreview } from '../printing';
import { ReprintLabel } from '../reprint/ReprintLabel';
import type { ScanOutcome } from './useScanFlow';

interface Props {
  result: ScanOutcome;
  nextRef: RefObject<HTMLButtonElement | null>;
  onNext: () => void;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col sm:flex-row sm:gap-3">
      <dt className="w-40 shrink-0 text-sm font-semibold text-ink-muted">{label}</dt>
      <dd className="font-medium break-words">{children}</dd>
    </div>
  );
}

export function ResultPanel({ result, nextRef, onNext }: Props) {
  const { t, dateTime, shortDateTime } = useI18n();
  /** Desktop: "Registered on Station 2 (Ravi) at 10:42, 11 Oct" (station, operator if set, server time). */
  const onStation = (
    key: 'result.registeredOn' | 'result.attemptedOn',
    node: string,
    person: string,
    at: string | null,
  ) => (
    <p
      className="font-semibold"
      data-testid={key === 'result.registeredOn' ? 'registered-on' : 'attempted-on'}
    >
      {t(key, { who: recordedBy(t, node, person), time: shortDateTime(at) })}
    </p>
  );
  if (result.result === 'duplicate') {
    const prev = result.existingRecord;
    const now = result.currentAttempt;
    return (
      <div role="alert" className="rounded-lg border-4 border-danger bg-danger-soft p-5">
        <p className="text-4xl font-extrabold text-danger">✕ {t('result.duplicateTitle')}</p>
        <p className="mt-2 text-2xl font-bold text-danger">{t('result.reengrave')}</p>
        <p className="mt-3 font-mono text-2xl font-bold break-all">{result.serial}</p>
        <p className="text-ink-muted">{t('result.doNotUse')}</p>

        <section className="mt-4 rounded-md border border-danger bg-surface p-3">
          <h2 className="text-sm font-extrabold tracking-wide text-danger uppercase">
            {t('result.previousRecord')}
          </h2>
          <dl className="mt-2 space-y-1">
            <Row label={t('common.company')}>{prev.company}</Row>
            <Row label={t('common.partNumber')}>{prev.partNo || '—'}</Row>
            {!prev.nodeName && (
              <>
                <Row label={t('result.registeredBy')}>{prev.scannedByName}</Row>
                <Row label={t('result.registeredAt')}>{dateTime(prev.scannedAt)}</Row>
              </>
            )}
          </dl>
          {prev.nodeName &&
            onStation('result.registeredOn', prev.nodeName, prev.scannedByName, prev.scannedAt)}
        </section>

        <section className="mt-3 rounded-md border border-line bg-surface p-3">
          <h2 className="text-sm font-extrabold tracking-wide text-ink-muted uppercase">
            {t('result.currentAttempt')}
          </h2>
          {now.nodeName ? (
            <div className="mt-2">
              {onStation('result.attemptedOn', now.nodeName, now.scannedByName, now.timestamp)}
            </div>
          ) : (
            <dl className="mt-2 space-y-1">
              <Row label={t('common.scannedBy')}>{now.scannedByName}</Row>
              <Row label={t('result.attemptedAt')}>{dateTime(now.timestamp)}</Row>
            </dl>
          )}
        </section>

        {/* Desktop: an ADMINISTRATOR may reprint the label of the product that already carries this
            serial (lost or damaged label). Never a label for the product scanned now. */}
        {dataService.capabilities.serialLookup && (
          <section className="mt-3 space-y-2" data-testid="duplicate-reprint">
            <p className="text-sm text-ink-muted">{t('reprint.duplicateHint')}</p>
            <ReprintLabel companyId={result.company.id} serial={result.serial} />
          </section>
        )}

        <Button
          ref={nextRef}
          variant="danger"
          onClick={onNext}
          className="mt-4 min-h-14 w-full text-lg"
        >
          {t('result.scanNext')}
        </Button>
      </div>
    );
  }

  return (
    <div role="status" className="rounded-lg border-2 border-success bg-success-soft p-5">
      <p className="text-3xl font-extrabold text-success">✓ {t('result.newTitle')}</p>
      <p className="mt-2 font-mono text-2xl font-bold break-all">{result.serial}</p>
      <dl className="mt-3 space-y-1">
        <Row label={t('common.company')}>{result.company.name}</Row>
        <Row label={t('common.partNumber')}>{result.partNo || '—'}</Row>
        <Row label={t('result.labelType')}>{t(codeTypeKey(result.company.codeType))}</Row>
        <Row label={t('result.inputMethod')}>
          {t(result.source === 'scan' ? 'source.scan' : 'source.manualEntry')}
        </Row>
        {!result.nodeName && (
          <>
            <Row label={t('common.scannedBy')}>{result.scannedByName}</Row>
            <Row label={t('result.registeredAt')}>{dateTime(result.scannedAt)}</Row>
          </>
        )}
      </dl>
      {result.nodeName && (
        <div className="mt-2">
          {onStation(
            'result.registeredOn',
            result.nodeName,
            result.scannedByName,
            result.scannedAt,
          )}
        </div>
      )}
      {/* New serials only: the label (barcode or QR per the COMPANY's setting) is generated from the
          verified result. A duplicate never reaches this branch, so it can never get a label. */}
      <LabelPreview result={result} />
      <div className="mt-3 flex flex-col gap-3 sm:flex-row">
        <Button ref={nextRef} onClick={onNext} className="min-h-14 flex-1 text-lg">
          {t('result.scanNext')}
        </Button>
      </div>
    </div>
  );
}
