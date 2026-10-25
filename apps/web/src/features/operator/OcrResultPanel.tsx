import { useRef, useState, type FormEvent } from 'react';
import { OCR_CONFIDENCE } from '../../config/ocr';
import { Button } from '../../components/ui/Button';
import { TextField } from '../../components/ui/TextField';
import { useI18n } from '../../hooks/useI18n';
import { SERIAL_INPUT_ID } from '../preferences';
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
  /** Sets the serial as-is (a suggestion or another reading chosen with a button). */
  onSerialChange: (value: string) => void;
  /** Typing in the field: screened by the parent (A-Z / 0-9 only, keyboard-language check). */
  onSerialType: (raw: string) => void;
  /** Already translated. */
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
  onSerialType,
  error,
  busy,
  onConfirm,
  onRetake,
  onManual,
}: Props) {
  const [checked, setChecked] = useState(false);
  const [needTick, setNeedTick] = useState(false);
  const fieldRef = useRef<HTMLInputElement>(null);
  const { t, rich } = useI18n();
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
        {t('ocrResult.title')}
      </h2>

      <img
        src={photo.url}
        alt={t('ocrResult.photoAlt')}
        className="max-h-40 w-full rounded border border-line bg-surface object-contain"
      />

      {level === 'high' && (
        <p className="rounded-md bg-info-soft px-3 py-2 text-sm text-info">
          {rich('ocrResult.high', { pct: <strong>{pct}</strong> })}
        </p>
      )}
      {level === 'medium' && (
        <p
          role="alert"
          className="rounded-md border-2 border-warn bg-warn-soft p-3 font-semibold text-warn"
        >
          {t('ocrResult.medium', { pct: pct ?? '' })}
        </p>
      )}
      {level === 'low' && (
        <p
          role="alert"
          className="rounded-md border-2 border-danger bg-danger-soft p-3 font-semibold text-danger"
        >
          {t('ocrResult.low', { pct: pct ?? '' })}
        </p>
      )}
      {level === 'unknown' && (
        <p className="rounded-md bg-info-soft px-3 py-2 text-sm text-info">
          {t('ocrResult.unknown')}
        </p>
      )}
      {formatMismatch && (
        <p className="rounded-md bg-warn-soft px-3 py-2 text-sm font-semibold text-warn">
          {t('ocrResult.formatMismatch', { company: company.name })}
        </p>
      )}

      <TextField
        ref={fieldRef}
        id={SERIAL_INPUT_ID}
        variant="code"
        label={t('ocrResult.fieldLabel')}
        value={serial}
        onChange={(e) => onSerialType(e.target.value)}
        lang="en"
        error={error}
        readOnly={busy}
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        className="min-h-16 text-2xl"
      />

      {suggestion && (
        <div className="rounded-md border border-action bg-action-soft p-3">
          <p className="text-sm font-semibold">{t('ocrResult.lookAlike')}</p>
          <button
            type="button"
            disabled={busy}
            onClick={() => onSerialChange(suggestion)}
            className="mt-2 min-h-touch w-full rounded-md bg-action px-3 font-mono text-lg font-bold text-on-accent hover:bg-action-hover"
          >
            {t('ocrResult.use', { serial: suggestion })}
          </button>
          <p className="mt-1 text-xs text-ink-muted">{t('ocrResult.notApplied')}</p>
        </div>
      )}

      {reading.alternatives.length > 0 && (
        <div>
          <p className="mb-1 text-sm font-semibold">{t('ocrResult.otherReadings')}</p>
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
            <span>{t('ocrResult.compared')}</span>
          </label>
          {needTick && !checked && (
            <p role="alert" className="mt-1 text-sm font-semibold text-danger">
              {t('ocrResult.tickRequired')}
            </p>
          )}
        </div>
      )}

      <div className="flex flex-col gap-3">
        {level === 'low' ? (
          <>
            <Button onClick={onRetake} disabled={busy} className="min-h-16 w-full text-xl">
              {t('scan.retakePhoto')}
            </Button>
            <Button
              type="submit"
              variant="secondary"
              disabled={busy || serial.trim() === '' || company.codeType === null}
              className="min-h-14 w-full text-lg"
            >
              {busy ? t('scan.checking') : t('ocrResult.confirmAnyway')}
            </Button>
          </>
        ) : (
          <>
            <Button
              type="submit"
              disabled={busy || serial.trim() === '' || company.codeType === null}
              className="min-h-16 w-full text-xl"
            >
              {busy ? t('scan.checking') : t('ocrResult.confirm')}
            </Button>
            <Button
              variant="secondary"
              onClick={onRetake}
              disabled={busy}
              className="min-h-14 w-full text-lg"
            >
              {t('scan.retakePhoto')}
            </Button>
          </>
        )}
        <Button
          variant="secondary"
          onClick={onManual}
          disabled={busy}
          className="min-h-14 w-full text-lg"
        >
          {t('scan.enterManually')}
        </Button>
      </div>
      <p className="text-xs text-ink-muted">
        {t('ocrResult.footer', {
          provider: reading.provider,
          high: OCR_CONFIDENCE.high,
          medium: OCR_CONFIDENCE.medium,
        })}
      </p>
    </form>
  );
}
