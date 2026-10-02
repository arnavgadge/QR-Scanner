import type { RefObject } from 'react';
import { Button } from '../../components/ui/Button';
import type { Company } from '../../types';
import type { ScanOutcome } from './useScanFlow';

interface Props {
  outcome: ScanOutcome;
  company: Company | undefined;
  nextRef: RefObject<HTMLButtonElement | null>;
  onNext: () => void;
}

export function ResultPanel({ outcome, company, nextRef, onNext }: Props) {
  const isDuplicate = outcome.result === 'duplicate';
  return (
    <div
      role={isDuplicate ? 'alert' : 'status'}
      className={`rounded-lg border-2 p-5 ${
        isDuplicate ? 'border-danger bg-danger-soft' : 'border-success bg-success-soft'
      }`}
    >
      <p className={`text-3xl font-extrabold ${isDuplicate ? 'text-danger' : 'text-success'}`}>
        {isDuplicate ? 'DUPLICATE — STOP' : 'NEW — REGISTERED'}
      </p>
      <p className="mt-2 font-mono text-2xl font-bold break-all">{outcome.serial}</p>
      <p className="mt-2 text-ink">
        {isDuplicate
          ? 'This serial already exists. Do not use it — re-engrave the product.'
          : `Label type: ${company?.codeType === 'qr' ? 'QR code' : 'Barcode'} (${company?.name ?? 'unknown company'})`}
      </p>
      <div className="mt-4 flex flex-col gap-3 sm:flex-row">
        <Button ref={nextRef} onClick={onNext} className="min-h-14 flex-1 text-lg">
          Scan next
        </Button>
        {!isDuplicate && (
          <Button variant="success" disabled className="min-h-14 flex-1 text-lg">
            Print label (coming later)
          </Button>
        )}
      </div>
    </div>
  );
}
