import { useRef, useState, type FormEvent } from 'react';
import { OCR_CONFIDENCE } from '../../config/ocr';
import { Button } from '../../components/ui/Button';
import { TextField } from '../../components/ui/TextField';
import type { Company } from '../../types';
import type { OcrReading, PhotoInfo } from './useScanFlow';

interface Props {
  photo: PhotoInfo;
  reading: OcrReading;
  company: Company;
  serial: string;
  /**
   * Format feedback for the CURRENT company and the CURRENT text (computed by the parent: the
   * company can be switched while this reading is on screen, so it must never be a snapshot from
   * when the photo was read). Verification itself always uses the selected company at confirm time.
   */
  formatMismatch: boolean;
  suggestion: string | null;
  onSerialChange: (value: string) => void;
  error: string | undefined;
  busy: boolean;
  onConfirm: () => void;
  onRetake: () => void;
  onManual: () => void;
}

/**
 * "Detected Serial": the OCR reading, editable. Registration happens only when the operator
 * presses Confirm & Check. Medium/low confidence readings additionally require ticking that the
 * serial was compared with the engraving.
 */
export function OcrResultPanel({
  photo,
  reading,
  company,
  serial,
  formatMismatch,
  suggestion,
  onSerialChange,
  error,
  busy,
  onConfirm,
  onRetake,
  onManual,
}: Props) {
  const [checked, setChecked] = useState(false);
  const [needTick, setNeedTick] = useState(false);
  const fieldRef = useRef<HTMLInputElement>(null);
  const level = reading.level;
  const needsCheck = level === 'medium' || level === 'low';
  const pct = reading.confidence !== undefined ? `${Math.round(reading.confidence)}%` : null;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (needsCheck && !checked) {
      setNeedTick(true);
      return;
    }
    onConfirm();
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-4" aria-labelledby="detected-title">
      <h2 id="detected-title" className="text-lg font-bold">
        Detected Serial
      </h2>

      <img
        src={photo.url}
        alt="Photo the serial was read from"
        className="max-h-40 w-full rounded border border-line bg-surface object-contain"
      />

      {level === 'high' && (
        <p className="rounded-md bg-info-soft px-3 py-2 text-sm text-info">
          Confidence: <strong>{pct}</strong> (high). Check the serial against the engraving, then
          confirm.
        </p>
      )}
      {level === 'medium' && (
        <p
          role="alert"
          className="rounded-md border-2 border-warn bg-warn-soft p-3 font-semibold text-warn"
        >
          Medium confidence ({pct}). Compare every character with the engraving before confirming.
        </p>
      )}
      {level === 'low' && (
        <p
          role="alert"
          className="rounded-md border-2 border-danger bg-danger-soft p-3 font-semibold text-danger"
        >
          Low confidence ({pct}). This reading is probably wrong. Retake the photo, or correct the
          serial below.
        </p>
      )}
      {level === 'unknown' && (
        <p className="rounded-md bg-info-soft px-3 py-2 text-sm text-info">
          This OCR engine did not report a confidence. Check the serial against the engraving, then
          confirm.
        </p>
      )}
      {formatMismatch && (
        <p className="rounded-md bg-warn-soft px-3 py-2 text-sm font-semibold text-warn">
          This does not match {company.name}&rsquo;s serial format. Correct it before confirming.
        </p>
      )}

      <TextField
        ref={fieldRef}
        variant="code"
        label="Detected serial (edit if the reading is wrong)"
        value={serial}
        onChange={(e) => onSerialChange(e.target.value)}
        error={error}
        readOnly={busy}
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        className="min-h-16 text-2xl"
      />

      {suggestion && (
        <div className="rounded-md border border-action bg-action-soft p-3">
          <p className="text-sm font-semibold">
            Looks like a look-alike character (e.g. O/0, I/1). Suggested fix from the serial format:
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => onSerialChange(suggestion)}
            className="mt-2 min-h-touch w-full rounded-md bg-action px-3 font-mono text-lg font-bold text-white hover:bg-action-hover"
          >
            Use {suggestion}
          </button>
          <p className="mt-1 text-xs text-ink-muted">
            Not applied automatically. Check it against the engraving.
          </p>
        </div>
      )}

      {reading.alternatives.length > 0 && (
        <div>
          <p className="mb-1 text-sm font-semibold">Other readings</p>
          <ul className="flex flex-wrap gap-2">
            {reading.alternatives.map((a) => (
              <li key={a.text}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onSerialChange(a.text)}
                  className="min-h-touch rounded-md border border-line bg-surface px-3 font-mono font-semibold hover:bg-info-soft"
                >
                  {a.text}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {needsCheck && (
        <div>
          <label className="flex min-h-touch items-start gap-3 text-base font-semibold">
            <input
              type="checkbox"
              checked={checked}
              onChange={(e) => {
                setChecked(e.target.checked);
                if (e.target.checked) setNeedTick(false);
              }}
              disabled={busy}
              className="mt-1 size-6 shrink-0"
            />
            <span>I compared this serial with the engraving.</span>
          </label>
          {needTick && !checked && (
            <p role="alert" className="mt-1 text-sm font-semibold text-danger">
              Tick the box to confirm you checked the serial.
            </p>
          )}
        </div>
      )}

      <div className="flex flex-col gap-3">
        {level === 'low' ? (
          <>
            <Button onClick={onRetake} disabled={busy} className="min-h-16 w-full text-xl">
              Retake Photo
            </Button>
            <Button
              type="submit"
              variant="secondary"
              disabled={busy || serial.trim() === '' || company.codeType === null}
              className="min-h-14 w-full text-lg"
            >
              {busy ? 'Checking…' : 'Confirm anyway & Check'}
            </Button>
          </>
        ) : (
          <>
            <Button
              type="submit"
              disabled={busy || serial.trim() === '' || company.codeType === null}
              className="min-h-16 w-full text-xl"
            >
              {busy ? 'Checking…' : 'Confirm & Check'}
            </Button>
            <Button
              variant="secondary"
              onClick={onRetake}
              disabled={busy}
              className="min-h-14 w-full text-lg"
            >
              Retake Photo
            </Button>
          </>
        )}
        <Button
          variant="secondary"
          onClick={onManual}
          disabled={busy}
          className="min-h-14 w-full text-lg"
        >
          Enter Manually
        </Button>
      </div>
      <p className="text-xs text-ink-muted">
        Read by {reading.provider}. Medium and low readings need your check; no reading is ever
        registered automatically (high confidence &ge; {OCR_CONFIDENCE.high}%, medium &ge;{' '}
        {OCR_CONFIDENCE.medium}%).
      </p>
    </form>
  );
}
