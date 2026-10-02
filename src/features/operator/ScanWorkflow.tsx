import { useEffect, useRef, type FormEvent } from 'react';
import { Button } from '../../components/ui/Button';
import { TextField } from '../../components/ui/TextField';
import { MOCK_DUPLICATE_EXAMPLE } from '../../services/serial/mockSerialService';
import { MOCK_COMPANIES } from '../companies/mockCompanies';
import { ResultPanel } from './ResultPanel';
import { useScanFlow } from './useScanFlow';

export function ScanWorkflow() {
  const flow = useScanFlow();
  const { step } = flow;
  const serialRef = useRef<HTMLInputElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  // Keyboard-first: keep focus where the operator types next.
  useEffect(() => {
    if (step === 'input' || step === 'ocr-review') serialRef.current?.focus();
    if (step === 'result') nextRef.current?.focus();
  }, [step]);

  const busy = step === 'ocr-running' || step === 'checking';
  const showForm = step !== 'result';
  const company = MOCK_COMPANIES.find((c) => c.id === flow.outcome?.companyId);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!busy) void flow.submit();
  };

  const onFile = (file: File | undefined) => {
    if (file) void flow.submitPhoto(file);
  };

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div>
        <p className="mb-4 rounded-md bg-info-soft px-3 py-2 text-sm text-info">
          Development mock: no data is saved. Try{' '}
          <span className="font-mono">{MOCK_DUPLICATE_EXAMPLE}</span> to see a duplicate.
        </p>

        {showForm && (
          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            <div>
              <label htmlFor="company" className="block text-sm font-semibold">
                Company
              </label>
              <select
                id="company"
                value={flow.companyId}
                onChange={(e) => flow.setCompanyId(e.target.value)}
                disabled={busy}
                className="mt-1 min-h-touch w-full rounded-md border border-line bg-surface px-3 text-base"
              >
                {MOCK_COMPANIES.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <TextField
              ref={serialRef}
              label={
                step === 'ocr-review'
                  ? 'Serial read from photo — check and correct'
                  : 'Serial number'
              }
              value={flow.serial}
              onChange={(e) => flow.setSerial(e.target.value)}
              error={flow.error}
              disabled={busy}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              placeholder="e.g. VC-123456"
            />

            <Button type="submit" disabled={busy} className="min-h-14 w-full text-lg">
              {step === 'checking'
                ? 'Checking…'
                : step === 'ocr-review'
                  ? 'Confirm and check'
                  : 'Check serial'}
            </Button>

            <div className="border-t border-line pt-4">
              <p className="mb-2 text-sm font-semibold">Or use a photo</p>
              <div className="flex flex-col gap-3 sm:flex-row">
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => cameraRef.current?.click()}
                  className="flex-1 md:hidden"
                >
                  Take photo
                </Button>
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => uploadRef.current?.click()}
                  className="flex-1"
                >
                  Upload photo
                </Button>
              </div>
              {/* Hidden native inputs; "capture" opens the rear camera on phones. */}
              <input
                ref={cameraRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                aria-label="Take photo of serial"
                onChange={(e) => {
                  onFile(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
              <input
                ref={uploadRef}
                type="file"
                accept="image/*"
                className="hidden"
                aria-label="Upload photo of serial"
                onChange={(e) => {
                  onFile(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
            </div>
          </form>
        )}
      </div>

      <div aria-live="polite">
        {step === 'result' && flow.outcome && (
          <ResultPanel
            outcome={flow.outcome}
            company={company}
            nextRef={nextRef}
            onNext={flow.reset}
          />
        )}
        {step !== 'result' && flow.photoUrl && (
          <figure className="rounded-lg border border-line bg-surface p-3">
            <img
              src={flow.photoUrl}
              alt="Captured serial"
              className="max-h-80 w-full rounded object-contain"
            />
            <figcaption className="mt-2 text-sm text-ink-muted">
              {step === 'ocr-running'
                ? 'Reading serial from photo…'
                : 'Photo captured. Confirm the text next to it.'}
            </figcaption>
            {step === 'ocr-review' && (
              <Button variant="secondary" onClick={flow.reset} className="mt-2 w-full">
                Discard photo
              </Button>
            )}
          </figure>
        )}
        {step === 'checking' && <p className="text-lg font-semibold text-info">Checking serial…</p>}
        {step === 'input' && !flow.photoUrl && (
          <p className="text-ink-muted">Type a serial and press Enter, or use a photo.</p>
        )}
      </div>
    </div>
  );
}
