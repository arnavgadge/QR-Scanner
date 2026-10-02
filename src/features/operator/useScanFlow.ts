import { useCallback, useEffect, useRef, useState } from 'react';
import { MOCK_COMPANIES } from '../companies/mockCompanies';
import { mockOcrService } from '../../services/ocr/mockOcr';
import { mockSerialService } from '../../services/serial/mockSerialService';
import type { ScanResult, SerialSource } from '../../types';

// Phase 1 wires the mock services; Phases 3-5 swap these for real ones.
const serialService = mockSerialService;
const ocrService = mockOcrService;

export type ScanStep = 'input' | 'ocr-running' | 'ocr-review' | 'checking' | 'result';

export interface ScanOutcome {
  result: ScanResult;
  serial: string;
  companyId: string;
}

/** Scan state machine: input -> (ocr) -> checking -> result -> input. No UI here. */
export function useScanFlow() {
  const [companyId, setCompanyId] = useState(MOCK_COMPANIES[0]?.id ?? '');
  const [serial, setSerial] = useState('');
  const [step, setStep] = useState<ScanStep>('input');
  const [source, setSource] = useState<SerialSource>('manual');
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [outcome, setOutcome] = useState<ScanOutcome | null>(null);
  const runId = useRef(0);

  useEffect(() => {
    return () => {
      if (photoUrl) URL.revokeObjectURL(photoUrl);
    };
  }, [photoUrl]);

  const reset = useCallback(() => {
    runId.current += 1; // invalidate any in-flight OCR/check
    setSerial('');
    setSource('manual');
    setPhotoUrl(null);
    setError(undefined);
    setOutcome(null);
    setStep('input');
  }, []);

  const submitPhoto = useCallback(async (file: File) => {
    const id = ++runId.current;
    setError(undefined);
    setSource('scan');
    setPhotoUrl(URL.createObjectURL(file));
    setStep('ocr-running');
    try {
      const { text } = await ocrService.extractSerial(file);
      if (id !== runId.current) return;
      setSerial(serialService.normalize(text));
    } catch {
      if (id !== runId.current) return;
      setSerial('');
      setError('Could not read the serial from the photo. Enter it manually.');
    }
    setStep('ocr-review');
  }, []);

  const submit = useCallback(async () => {
    const check = await serialService.validate(serial, companyId);
    if (!check.valid) {
      setError(check.error);
      return;
    }
    const id = ++runId.current;
    setError(undefined);
    setSerial(check.normalized);
    setStep('checking');
    try {
      const res = await serialService.register({
        serial: check.normalized,
        partNumber: '',
        companyId,
        source,
      });
      if (id !== runId.current) return;
      setOutcome({ result: res.result, serial: check.normalized, companyId });
      setStep('result');
    } catch {
      if (id !== runId.current) return;
      setError('Check failed. Please try again.');
      setStep(source === 'scan' ? 'ocr-review' : 'input');
    }
  }, [serial, companyId, source]);

  return {
    step,
    serial,
    setSerial,
    companyId,
    setCompanyId,
    photoUrl,
    error,
    outcome,
    submit,
    submitPhoto,
    reset,
  };
}
