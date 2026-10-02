import type { CodeType } from '../../types';

/** Printing boundary. Barcode/QR rendering and browser printing arrive in a later phase. */
export interface LabelRequest {
  serial: string;
  partNumber: string;
  companyName: string;
  codeType: CodeType;
}

export interface PrintingService {
  prepareLabel(request: LabelRequest): Promise<HTMLElement>;
  print(label: HTMLElement): Promise<void>;
}
