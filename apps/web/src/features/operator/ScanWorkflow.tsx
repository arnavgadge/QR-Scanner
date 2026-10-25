import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ErrorNotice } from '../../components/common/ErrorNotice';
import { LoadingState } from '../../components/common/LoadingState';
import { Button } from '../../components/ui/Button';
import { TextField } from '../../components/ui/TextField';
import { useCompanies } from '../../hooks/useCompanies';
import { useConnection } from '../../hooks/useConnection';
import { useI18n } from '../../hooks/useI18n';
import { msg } from '../../i18n';
import { OCR_PROVIDER_LABEL } from '../../services/ocr';
import { USE_MOCK_OCR } from '../../config/ocr';
import { describeSerialFormatMsg, ocrFormatFeedback } from '../../services/serial/serialFormat';
import { codeTypeKey } from '../companies/codeTypeLabel';
import { CompanyInfoCard } from '../companies/CompanyInfoCard';
import { SERIAL_INPUT_ID } from '../preferences';
import { OcrResultPanel } from './OcrResultPanel';
import { PhotoCapture } from './PhotoCapture';
import { PhotoPreview } from './PhotoPreview';
import { ResultPanel } from './ResultPanel';
import { screenSerialInput, SERIAL_INPUT_MESSAGES, type SerialInputProblem } from './serialInput';
import { useScanFlow, type ScanStep } from './useScanFlow';

interface Props {
  /** Called after a serial was verified (new or duplicate) so recent scans can refresh. */
  onVerified?: () => void;
}

const IMAGE_ACCEPT = 'image/*';

export function ScanWorkflow({ onVerified }: Props) {
  const companies = useCompanies();
  const flow = useScanFlow(companies.selected, onVerified);
  const { state } = flow;
  const { t, text } = useI18n();
  // Desktop: nothing can be checked while the main computer is unreachable (no queue).
  const connected = useConnection() === 'online';
  const serialRef = useRef<HTMLInputElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const retryRef = useRef<HTMLButtonElement>(null);
  const ocrRetakeRef = useRef<HTMLButtonElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const { photoNotice } = flow;
  // Refused keystrokes (e.g. a Hindi keyboard layout). Tied to the step it happened on, so it
  // disappears by itself when the operator moves on.
  const [inputProblem, setInputProblem] = useState<{
    step: ScanStep;
    problem: SerialInputProblem;
  } | null>(null);

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
    const onCancel = () => photoNotice(msg('scan.cameraCancelled'));
    el.addEventListener('cancel', onCancel);
    return () => el.removeEventListener('cancel', onCancel);
  }, [photoNotice, companies.status]);

  if (companies.status === 'loading') {
    return <LoadingState label={t('scan.loadingCompanies')} />;
  }
  if (companies.status === 'error') {
    return <ErrorNotice message={companies.message} onRetry={companies.reload} />;
  }
  if (companies.companies.length === 0) {
    return <ErrorNotice message={msg('scan.noCompanies')} onRetry={companies.reload} />;
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

  /** Typing in either serial field: only A-Z / 0-9 get in; anything else is refused with a reason. */
  const typeSerial = (raw: string) => {
    const screened = screenSerialInput(raw);
    if (screened.accepted) {
      setInputProblem(null);
      flow.setSerial(screened.value);
    } else {
      setInputProblem({ step: view.step, problem: screened.problem });
    }
  };
  const shownProblem = inputProblem?.step === view.step ? inputProblem.problem : null;
  const serialError = shownProblem
    ? t(SERIAL_INPUT_MESSAGES[shownProblem])
    : flow.validationError !== undefined
      ? text(flow.validationError)
      : undefined;

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
        aria-label={t('scan.takePhotoAria')}
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
        aria-label={t('scan.choosePhotoAria')}
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
            {/* Developer-only (never in a production build, see verify-prod-bundle), so this one
                notice is deliberately not in the translation dictionaries. */}
            DEVELOPMENT: using {OCR_PROVIDER_LABEL}. Photos are not really read.
          </p>
        )}

        {showModeToggle && (
          <div role="group" aria-label={t('scan.inputMethod')} className="grid grid-cols-2 gap-2">
            <Button
              variant={view.step === 'input' ? 'primary' : 'secondary'}
              aria-pressed={view.step === 'input'}
              onClick={flow.switchToManual}
              className="min-h-14"
            >
              {t('scan.enterManually')}
            </Button>
            <Button
              variant={view.step === 'photo-start' ? 'primary' : 'secondary'}
              aria-pressed={view.step === 'photo-start'}
              onClick={flow.startPhoto}
              className="min-h-14"
            >
              {t('scan.uploadPhoto')}
            </Button>
          </div>
        )}

        {showCompany && (
          <div className="space-y-3">
            <div>
              <label htmlFor="company" className="block text-sm font-semibold">
                {t('common.company')}
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
                    {t('scan.companyOption', {
                      company: c.name,
                      type: msg(codeTypeKey(c.codeType)),
                    })}
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
              id={SERIAL_INPUT_ID}
              variant="code"
              ref={serialRef}
              label={t('scan.serialLabel')}
              value={flow.serial}
              onChange={(e) => typeSerial(e.target.value)}
              error={serialError}
              hint={
                selected
                  ? t('scan.formatHint', { format: describeSerialFormatMsg(selected.serialFormat) })
                  : undefined
              }
              readOnly={busy}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              lang="en"
              inputMode="text"
            />
            <Button
              type="submit"
              disabled={busy || !connected || !selected || selected.codeType === null}
              className="min-h-14 w-full text-lg"
            >
              {busy ? t('scan.checking') : t('scan.check')}
            </Button>
          </form>
        )}

        {view.step === 'photo-start' && (
          <PhotoCapture
            notice={view.notice && text(view.notice)}
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
            onSerialType={typeSerial}
            error={serialError}
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
            <p className="text-2xl font-extrabold text-danger">{t('scan.photoNotRead')}</p>
            <p className="text-lg">{text(view.message)}</p>
            <p className="text-ink-muted">{t('scan.nothingRegistered')}</p>
            <div className="flex flex-col gap-3">
              <Button
                ref={ocrRetakeRef}
                onClick={retakeAndOpen}
                className="min-h-16 w-full text-xl"
              >
                {t('scan.retakePhoto')}
              </Button>
              <Button
                variant="secondary"
                onClick={flow.switchToManual}
                className="min-h-14 w-full text-lg"
              >
                {t('scan.enterManually')}
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
            <p className="text-2xl font-extrabold text-danger">{t('scan.notVerified')}</p>
            <p className="mt-2 text-lg">{text(state.message)}</p>
            <p className="mt-1 text-ink-muted">{t('scan.notVerifiedBody')}</p>
            <Button ref={retryRef} onClick={flow.retry} className="mt-4 min-h-14 w-full text-lg">
              {t('common.tryAgain')}
            </Button>
          </div>
        )}
        {state.step === 'checking' && <LoadingState label={t('scan.checkingSerial')} />}
        {state.step === 'input' && (
          <p className="text-ink-muted">{t('scan.idleHint', { button: msg('scan.check') })}</p>
        )}
        {state.step === 'photo-start' && (
          <p className="hidden text-ink-muted lg:block">{t('scan.photoIdleHint')}</p>
        )}
      </div>
    </div>
  );
}
