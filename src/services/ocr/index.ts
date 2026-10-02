/** OCR adapter boundary. A concrete provider is introduced in a later phase. */
export interface OCRResult {
  /** Raw text candidate for the serial; the user always confirms it. */
  text: string;
  /** 0..1 if the provider reports it. */
  confidence?: number;
}

export interface OCRService {
  extractSerial(image: Blob): Promise<OCRResult>;
}
