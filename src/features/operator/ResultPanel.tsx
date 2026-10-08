import type { ReactNode, RefObject } from 'react';
import { Button } from '../../components/ui/Button';
import { formatDateTime } from '../../utils/format';
import { codeTypeLabel } from '../companies/codeTypeLabel';
import { LabelPreview } from '../printing';
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
  if (result.result === 'duplicate') {
    const prev = result.existingRecord;
    const now = result.currentAttempt;
    return (
      <div role="alert" className="rounded-lg border-4 border-danger bg-danger-soft p-5">
        <p className="text-4xl font-extrabold text-danger">✕ Duplicate Serial</p>
        <p className="mt-2 text-2xl font-bold text-danger">Send for re-engraving</p>
        <p className="mt-3 font-mono text-2xl font-bold break-all">{result.serial}</p>
        <p className="text-ink-muted">Do not use this serial. No label will be printed.</p>

        <section className="mt-4 rounded-md border border-danger bg-surface p-3">
          <h2 className="text-sm font-extrabold tracking-wide text-danger uppercase">
            Previous record
          </h2>
          <dl className="mt-2 space-y-1">
            <Row label="Company">{prev.company}</Row>
            <Row label="Part number">{prev.partNo || '—'}</Row>
            <Row label="Registered by">{prev.scannedByName}</Row>
            <Row label="Registered at">{formatDateTime(prev.scannedAt)}</Row>
          </dl>
        </section>

        <section className="mt-3 rounded-md border border-line bg-surface p-3">
          <h2 className="text-sm font-extrabold tracking-wide text-ink-muted uppercase">
            Current attempt
          </h2>
          <dl className="mt-2 space-y-1">
            <Row label="Scanned by">{now.scannedByName}</Row>
            <Row label="Attempted at">{formatDateTime(now.timestamp)}</Row>
          </dl>
        </section>

        <Button
          ref={nextRef}
          variant="danger"
          onClick={onNext}
          className="mt-4 min-h-14 w-full text-lg"
        >
          Scan next
        </Button>
      </div>
    );
  }

  return (
    <div role="status" className="rounded-lg border-2 border-success bg-success-soft p-5">
      <p className="text-3xl font-extrabold text-success">✓ New Serial Registered!</p>
      <p className="mt-2 font-mono text-2xl font-bold break-all">{result.serial}</p>
      <dl className="mt-3 space-y-1">
        <Row label="Company">{result.company.name}</Row>
        <Row label="Part number">{result.partNo || '—'}</Row>
        <Row label="Label type">{codeTypeLabel(result.company.codeType)}</Row>
        <Row label="Input method">{result.source === 'scan' ? 'Photo (OCR)' : 'Manual entry'}</Row>
        <Row label="Scanned by">{result.scannedByName}</Row>
        <Row label="Registered at">{formatDateTime(result.scannedAt)}</Row>
      </dl>
      {/* New serials only: the label (barcode or QR per the COMPANY's setting) is generated from the
          verified result. A duplicate never reaches this branch, so it can never get a label. */}
      <LabelPreview result={result} />
      <div className="mt-3 flex flex-col gap-3 sm:flex-row">
        <Button ref={nextRef} onClick={onNext} className="min-h-14 flex-1 text-lg">
          Scan next
        </Button>
      </div>
    </div>
  );
}
