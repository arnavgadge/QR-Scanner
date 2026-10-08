import { useEffect, useRef, type FormEvent } from 'react';
import { ErrorNotice } from '../../components/common/ErrorNotice';
import { LoadingState } from '../../components/common/LoadingState';
import { Button } from '../../components/ui/Button';
import { TextField } from '../../components/ui/TextField';
import { useCompanies } from '../../hooks/useCompanies';
import { OCR_PROVIDER_LABEL } from '../../services/ocr';
import { USE_MOCK_OCR } from '../../config/ocr';
import { describeSerialFormat, ocrFormatFeedback } from '../../services/serial/serialFormat';
import { codeTypeLabel } from '../companies/codeTypeLabel';
import { CompanyInfoCard } from '../companies/CompanyInfoCard';
import { OcrResultPanel } from './OcrResultPanel';
import { PhotoCapture } from './PhotoCapture';
import { PhotoPreview } from './PhotoPreview';
import { ResultPanel } from './ResultPanel';
import { useScanFlow } from './useScanFlow';

interface Props {
  /** Called after a serial was verified (new or duplicate) so recent scans can refresh. */
  onVerified?: () => void;
}

const IMAGE_ACCEPT = 'image/*';

export function ScanWorkflow({ onVerified }: Props) {
  const companies = useCompanies();
  const flow = useScanFlow(companies.selected, onVerified);
  const { state } = flow;
  const serialRef = useRef<HTMLInputElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const retryRef = useRef<HTMLButtonElement>(null);
  const ocrRetakeRef = useRef<HTMLButtonElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const { photoNotice } = flow;

  // Keyboard-first: keep focus where the operator acts next.
  useEffect(() => {
    if (state.step === 'input') serialRef.current?.focus();
    if (state.step === 'result') nextRef.current?.focus();
    if (state.step === 'failed') retryRef.current?.focus();
    if (state.step === 'ocr-error') ocrRetakeRef.current?.focus();
    // `companies.status`: the form only exists once the company list has loaded, so focus must be
    // (re)applied then, otherwise a freshly loaded page leaves the focus on <body>.
  }, [state.step, companies.status]);

  // A cancelled camera picker usually means the camera could not be opened (e.g. permission denied).
  useEffect(() => {
    const el = cameraRef.current;
    if (!el) return;
    const onCancel = () =>
      photoNotice(
        'No photo was taken. Camera access was not available, or the camera was closed. Choose a photo or enter the serial manually.',
      );
    el.addEventListener('cancel', onCancel);
    return () => el.removeEventListener('cancel', onCancel);
  }, [photoNotice, companies.status]);

  if (companies.status === 'loading') {
    return <LoadingState label="Loading company configuration…" />;
  }
  if (companies.status === 'error') {
    return <ErrorNotice message={companies.message} onRetry={companies.reload} />;
  }
  if (companies.companies.length === 0) {
    return (
      <ErrorNotice
        message="No active company is configured, so serials cannot be checked yet. Ask an administrator to add or activate a company, then reload this page."
        onRetry={companies.reload}
      />
    );
  }

  const selected = companies.selected;
  // While verifying, keep showing the screen the operator came from (disabled).
  const view = state.step === 'checking' ? state.from : state;
  const busy = state.step === 'checking';
  const inPhotoMode =
    view.step === 'photo-start' ||
    view.step === 'photo-selected' ||
    view.step === 'ocr-running' ||
    view.step === 'ocr-result' ||
    view.step === 'ocr-error';
  const showCompany =
    view.step !== 'result' && view.step !== 'failed' && view.step !== 'ocr-running';
  // Recomputed on every render from the company selected NOW and the text in the field NOW.
  const ocrFeedback =
    view.step === 'ocr-result' && selected
      ? ocrFormatFeedback(flow.serial, view.reading.text, selected.serialFormat)
      : { mismatch: false, suggestion: null };
  const showModeToggle = view.step === 'input' || view.step === 'photo-start';

  // Enter in the field and the button both land here: one verification path.
  const onSubmitManual = (e: FormEvent) => {
    e.preventDefault();
    if (!busy) void flow.submit();
  };

  const takePhoto = () => cameraRef.current?.click();
  const choosePhoto = () => uploadRef.current?.click();
  const onFile = (file: File | undefined) => {
    if (file) flow.selectPhoto(file);
  };
  const retakeAndOpen = () => {
    flow.retake();
    // Opened inside the click handler so the browser allows the picker/camera.
    (window.matchMedia('(max-width: 767px)').matches ? cameraRef : uploadRef).current?.click();
  };

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* Hidden native inputs: "capture" opens the rear camera on phones; both stay mounted. */}
      <input
        ref={cameraRef}
        type="file"
        accept={IMAGE_ACCEPT}
        capture="environment"
        className="hidden"
        aria-label="Take photo of serial"
        data-testid="camera-input"
        onChange={(e) => {
          onFile(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      <input
        ref={uploadRef}
        type="file"
        accept={IMAGE_ACCEPT}
        className="hidden"
        aria-label="Choose photo of serial"
        data-testid="upload-input"
        onChange={(e) => {
          onFile(e.target.files?.[0]);
          e.target.value = '';
        }}
      />

      <div className="space-y-4">
        {USE_MOCK_OCR && inPhotoMode && (
          <p
            role="note"
            className="rounded-md bg-warn-soft px-3 py-2 text-sm font-semibold text-warn"
          >
            DEVELOPMENT: using {OCR_PROVIDER_LABEL}. Photos are not really read.
          </p>
        )}

        {showModeToggle && (
          <div role="group" aria-label="Input method" className="grid grid-cols-2 gap-2">
            <Button
              variant={view.step === 'input' ? 'primary' : 'secondary'}
              aria-pressed={view.step === 'input'}
              onClick={flow.switchToManual}
              className="min-h-14"
            >
              Enter Manually
            </Button>
            <Button
              variant={view.step === 'photo-start' ? 'primary' : 'secondary'}
              aria-pressed={view.step === 'photo-start'}
              onClick={flow.startPhoto}
              className="min-h-14"
            >
              Upload Photo (OCR)
            </Button>
          </div>
        )}

        {showCompany && (
          <div className="space-y-3">
            <div>
              <label htmlFor="company" className="block text-sm font-semibold">
                Company
              </label>
              <select
                id="company"
                value={companies.selectedId}
                onChange={(e) => companies.select(e.target.value)}
                disabled={busy}
                className="mt-1 min-h-touch w-full rounded-md border border-line bg-surface px-3 text-base"
              >
                {companies.companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} — {codeTypeLabel(c.codeType)}
                  </option>
                ))}
              </select>
            </div>
            {selected && <CompanyInfoCard company={selected} />}
          </div>
        )}

        {view.step === 'input' && (
          <form onSubmit={onSubmitManual} className="space-y-4" noValidate>
            <TextField
              variant="code"
              ref={serialRef}
              label="Serial number"
              value={flow.serial}
              onChange={(e) => flow.setSerial(e.target.value)}
              error={flow.validationError}
              hint={selected ? `Format: ${describeSerialFormat(selected.serialFormat)}` : undefined}
              readOnly={busy}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
            />
            <Button
              type="submit"
              disabled={busy || !selected || selected.codeType === null}
              className="min-h-14 w-full text-lg"
            >
              {busy ? 'Checking…' : 'Check serial'}
            </Button>
          </form>
        )}

        {view.step === 'photo-start' && (
          <PhotoCapture
            notice={view.notice}
            onTake={takePhoto}
            onChoose={choosePhoto}
            onManual={flow.switchToManual}
          />
        )}

        {(view.step === 'photo-selected' || view.step === 'ocr-running') && (
          <PhotoPreview
            photo={view.photo}
            processing={view.step === 'ocr-running'}
            onRead={() => void flow.readSerial()}
            onRetake={retakeAndOpen}
            onCancel={flow.switchToManual}
          />
        )}

        {view.step === 'ocr-result' && selected && (
          <OcrResultPanel
            key={view.photo.url}
            photo={view.photo}
            reading={view.reading}
            company={selected}
            serial={flow.serial}
            formatMismatch={ocrFeedback.mismatch}
            suggestion={ocrFeedback.suggestion}
            onSerialChange={flow.setSerial}
            error={flow.validationError}
            busy={busy}
            onConfirm={() => void flow.submit()}
            onRetake={retakeAndOpen}
            onManual={flow.switchToManual}
          />
        )}

        {view.step === 'ocr-error' && (
          <div
            role="alert"
            className="space-y-4 rounded-lg border-2 border-danger bg-danger-soft p-5"
          >
            <p className="text-2xl font-extrabold text-danger">Photo not read</p>
            <p className="text-lg">{view.message}</p>
            <p className="text-ink-muted">Nothing was registered.</p>
            <div className="flex flex-col gap-3">
              <Button
                ref={ocrRetakeRef}
                onClick={retakeAndOpen}
                className="min-h-16 w-full text-xl"
              >
                Retake Photo
              </Button>
              <Button
                variant="secondary"
                onClick={flow.switchToManual}
                className="min-h-14 w-full text-lg"
              >
                Enter Manually
              </Button>
            </div>
          </div>
        )}
      </div>

      <div aria-live="polite">
        {state.step === 'result' && (
          <ResultPanel result={state.result} nextRef={nextRef} onNext={flow.next} />
        )}
        {state.step === 'failed' && (
          <div role="alert" className="rounded-lg border-2 border-danger bg-danger-soft p-5">
            <p className="text-2xl font-extrabold text-danger">Not verified</p>
            <p className="mt-2 text-lg">{state.message}</p>
            <p className="mt-1 text-ink-muted">
              Nothing was registered. Do not treat this serial as new.
            </p>
            <Button ref={retryRef} onClick={flow.retry} className="mt-4 min-h-14 w-full text-lg">
              Try again
            </Button>
          </div>
        )}
        {state.step === 'checking' && <LoadingState label="Checking serial…" />}
        {state.step === 'input' && (
          <p className="text-ink-muted">Type a serial and press Enter or click “Check serial”.</p>
        )}
        {state.step === 'photo-start' && (
          <p className="hidden text-ink-muted lg:block">
            Take or choose a photo of the engraved serial. You will review and confirm what was read
            before anything is checked.
          </p>
        )}
      </div>
    </div>
  );
}
