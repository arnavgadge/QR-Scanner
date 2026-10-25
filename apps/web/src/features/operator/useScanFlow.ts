import { useCallback, useEffect, useRef, useState } from 'react';
import { confidenceLevel, OCR_MAX_FILE_BYTES, type ConfidenceLevel } from '../../config/ocr';
import {
  getOcrService,
  OcrError,
  pickSerialCandidate,
  type OCRCandidate,
} from '../../services/ocr';
import { dataService } from '../../data';
import type { DuplicateSerialResult, NewSerialResult } from '../../services/serial';
import { validateSerialFormat } from '../../services/serial/serialFormat';
import { msg, type Msg, type Text } from '../../i18n/core';
import type { Company } from '../../types';

export type ScanOutcome = NewSerialResult | DuplicateSerialResult;

/** A photo held in memory only (object URL for the preview); discarded when the workflow leaves it. */
export interface PhotoInfo {
  file: File;
  url: string;
}

/** What the OCR engine read, ready for the operator to review. Nothing is registered yet. */
export interface OcrReading {
  text: string;
  /** Engine-reported percent (0-100); absent if the engine reports none. Never invented. */
  confidence?: number;
  level: ConfidenceLevel;
  alternatives: OCRCandidate[];
  // Format feedback (mismatch warning, look-alike suggestion) is NOT stored here: the company can
  // change while the reading is on screen, so OcrResultPanel derives it from the current company.
  provider: string;
}

type InputState = { step: 'input' };
type OcrResultState = { step: 'ocr-result'; photo: PhotoInfo; reading: OcrReading };
/** The two states from which a serial can be submitted for verification. */
type Verifiable = InputState | OcrResultState;

/**
 * One state machine for BOTH input methods; they converge on the same `submit`.
 *
 *  manual : input ─────────────────────────────┐
 *  photo  : photo-start → photo-selected → ocr-running → ocr-result ┤→ checking → result | failed
 *                                      ↘ ocr-error                  ┘
 *
 *  photo-start     choose / take a photo
 *  photo-selected  preview; Read Serial / Retake / Cancel
 *  ocr-running     OCR in progress (cancellable)
 *  ocr-result      "Detected Serial": editable, the operator must confirm (never auto-registered)
 *  ocr-error       nothing usable was read (or OCR failed); nothing was registered
 *  checking        verification in flight (the shared Phase 3 service)
 *  result          committed outcome: new (green) or duplicate (red)
 *  failed          the database could not verify; NOTHING was registered
 * Cancelling a photo returns straight to the idle manual state.
 */
export type ScanState =
  | InputState
  | { step: 'photo-start'; notice?: Msg }
  | { step: 'photo-selected'; photo: PhotoInfo }
  | { step: 'ocr-running'; photo: PhotoInfo }
  | OcrResultState
  | { step: 'ocr-error'; photo: PhotoInfo | null; message: Msg }
  | { step: 'checking'; from: Verifiable }
  | { step: 'result'; result: ScanOutcome }
  | { step: 'failed'; message: Text; from: Verifiable };

export type ScanStep = ScanState['step'];

const IMAGE_EXT = /\.(jpe?g|png|webp|gif|bmp|heic|heif)$/i;
const UNREADABLE = msg('ocr.unreadable');
const MAX_PHOTO_MB = Math.round(OCR_MAX_FILE_BYTES / (1024 * 1024));

export function useScanFlow(company: Company | undefined, onVerified?: () => void) {
  const [state, setState] = useState<ScanState>({ step: 'input' });
  const [serial, setSerial] = useState('');
  const [validationError, setValidationError] = useState<Text | undefined>();
  // Synchronous guard: state updates are async, so a fast double click/Enter could otherwise
  // start two verifications before `step` flips to 'checking'.
  const inFlight = useRef(false);
  const ocrAbort = useRef<AbortController | null>(null);
  const photoUrl = useRef<string | null>(null);
  const lastWasPhoto = useRef(false);

  /** Photos are never stored: release the in-memory preview when the workflow leaves the photo. */
  const dropPhoto = useCallback(() => {
    ocrAbort.current?.abort();
    ocrAbort.current = null;
    if (photoUrl.current) URL.revokeObjectURL(photoUrl.current);
    photoUrl.current = null;
  }, []);

  useEffect(() => dropPhoto, [dropPhoto]);

  // ---------------- photo path ----------------

  const startPhoto = useCallback(() => {
    setValidationError(undefined);
    setState({ step: 'photo-start' });
  }, []);

  /** Leaving the photo flow without a result (also "Cancel"): nothing was written. */
  const switchToManual = useCallback(() => {
    dropPhoto();
    setSerial('');
    setValidationError(undefined);
    setState({ step: 'input' });
  }, [dropPhoto]);

  const retake = useCallback(() => {
    dropPhoto();
    setSerial('');
    setValidationError(undefined);
    setState({ step: 'photo-start' });
  }, [dropPhoto]);

  const photoNotice = useCallback((notice: Msg) => {
    setState((s) => (s.step === 'photo-start' ? { step: 'photo-start', notice } : s));
  }, []);

  const selectPhoto = useCallback(
    (file: File) => {
      if (!file.type.startsWith('image/') && !IMAGE_EXT.test(file.name)) {
        setState({
          step: 'photo-start',
          notice: msg('ocr.notImage'),
        });
        return;
      }
      if (file.size > OCR_MAX_FILE_BYTES) {
        setState({
          step: 'photo-start',
          notice: msg('ocr.tooLarge', { mb: MAX_PHOTO_MB }),
        });
        return;
      }
      dropPhoto();
      const photo: PhotoInfo = { file, url: URL.createObjectURL(file) };
      photoUrl.current = photo.url;
      setSerial('');
      setValidationError(undefined);
      setState({ step: 'photo-selected', photo });
      // Start loading the engine now so "Read Serial" is quicker.
      void getOcrService()
        .then((s) => s.warmUp?.())
        .catch(() => undefined);
    },
    [dropPhoto],
  );

  /** Runs OCR on the selected photo. Only ever produces a reading to REVIEW; never registers. */
  const readSerial = useCallback(async () => {
    const photo =
      state.step === 'photo-selected' || state.step === 'ocr-error' ? state.photo : null;
    if (!photo) return;
    const ac = new AbortController();
    ocrAbort.current = ac;
    setState({ step: 'ocr-running', photo });
    try {
      const service = await getOcrService();
      const result = await service.recognize(photo.file, { signal: ac.signal });
      if (ac.signal.aborted) return;
      const format = company?.serialFormat ?? '';
      const picked = pickSerialCandidate(
        result,
        format.trim() === '' ? undefined : (text) => validateSerialFormat(text, format),
      );
      if (!picked) {
        setState({ step: 'ocr-error', photo, message: UNREADABLE });
        return;
      }
      setSerial(picked.text);
      setValidationError(undefined);
      setState({
        step: 'ocr-result',
        photo,
        reading: {
          text: picked.text,
          ...(picked.confidence !== undefined ? { confidence: picked.confidence } : {}),
          level: confidenceLevel(picked.confidence),
          alternatives: picked.alternatives,
          provider: result.provider,
        },
      });
    } catch (e) {
      if (ac.signal.aborted || (e instanceof OcrError && e.code === 'aborted')) return;
      const code = e instanceof OcrError ? e.code : 'failed';
      setState({
        step: 'ocr-error',
        photo,
        message:
          code === 'unreadable-image'
            ? msg('ocr.badImage')
            : code === 'provider-unavailable'
              ? msg('ocr.unavailable')
              : UNREADABLE,
      });
    } finally {
      if (ocrAbort.current === ac) ocrAbort.current = null;
    }
  }, [state, company]);

  // ---------------- shared verification (manual AND photo) ----------------

  /**
   * The single verification path, used by the button and the Enter key, for manual entry and for
   * a confirmed OCR reading alike: it calls the shared Phase 3 service. Only the `source` differs.
   */
  const submit = useCallback(async () => {
    if (inFlight.current) return;
    if (state.step !== 'input' && state.step !== 'ocr-result') return;
    inFlight.current = true;
    const from: Verifiable = state;
    const source = from.step === 'ocr-result' ? 'scan' : 'manual';
    lastWasPhoto.current = source === 'scan';
    setValidationError(undefined);
    setState({ step: 'checking', from });
    try {
      const outcome = await dataService.registerSerial({
        serial,
        companyId: company?.id ?? '',
        source,
      });
      switch (outcome.result) {
        case 'new':
        case 'duplicate':
          dropPhoto();
          setState({ step: 'result', result: outcome });
          onVerified?.();
          break;
        case 'invalid':
          setValidationError(outcome.msg);
          setState(from); // back to where the operator can edit / retake
          break;
        case 'error':
          setState({ step: 'failed', message: outcome.msg, from });
          break;
      }
    } finally {
      inFlight.current = false;
    }
  }, [state, serial, company, dropPhoto, onVerified]);

  /** Back to idle for the next serial (photo mode again if the last one came from a photo). */
  const next = useCallback(() => {
    dropPhoto();
    setSerial('');
    setValidationError(undefined);
    setState(lastWasPhoto.current ? { step: 'photo-start' } : { step: 'input' });
  }, [dropPhoto]);

  /** After a failed verification: back to where the operator was, keeping what they typed. */
  const retry = useCallback(() => {
    setState((s) => (s.step === 'failed' ? s.from : s));
  }, []);

  return {
    state,
    serial,
    setSerial,
    validationError,
    startPhoto,
    switchToManual,
    retake,
    photoNotice,
    selectPhoto,
    readSerial,
    submit,
    next,
    retry,
  };
}
