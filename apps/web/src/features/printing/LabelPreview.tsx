import { useMemo, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { useI18n } from '../../hooks/useI18n';
import { msg } from '../../i18n';
import { codeTypeKey } from '../companies/codeTypeLabel';
import {
  buildLabelData,
  generateLabelCode,
  type GeneratedCode,
  type LabelData,
} from '../../services/printing';
import type { NewSerialResult } from '../../services/serial';
import { BarcodeLabel } from './BarcodeLabel';
import { PrintableLabel } from './PrintableLabel';
import { PrintControls } from './PrintControls';
import { QRCodeLabel } from './QRCodeLabel';

import { logError } from '../../utils/log';
type Generation = { ok: true; code: GeneratedCode } | { ok: false };

function LabelWithCode({ label, onRetry }: { label: LabelData; onRetry: () => void }) {
  const { t, rich } = useI18n();
  // Generated once per label (not on every render). A retry remounts this component (new key in
  // the parent), which regenerates; label data changes (serial/company/type) do the same.
  const generation = useMemo<Generation>(() => {
    try {
      return { ok: true, code: generateLabelCode(label) };
    } catch (e) {
      logError('Label code generation failed', e);
      return { ok: false };
    }
  }, [label]);

  if (!generation.ok) {
    return (
      <div
        data-testid="label-error"
        role="alert"
        className="rounded-lg border-2 border-danger bg-danger-soft p-4"
      >
        <p className="text-lg font-bold text-danger">{t('labelPreview.generationFailed')}</p>
        <p className="mt-1 font-mono font-bold break-all">{label.serial}</p>
        <p className="mt-1 text-sm text-ink-muted">{t('labelPreview.generationFailedBody')}</p>
        <Button variant="secondary" onClick={onRetry} className="mt-3">
          {t('common.retry')}
        </Button>
      </div>
    );
  }

  const { code } = generation;
  return (
    <div className="space-y-2">
      {code.kind === 'barcode' ? (
        <BarcodeLabel label={label} code={code} />
      ) : (
        <QRCodeLabel label={label} code={code} />
      )}
      <p className="text-sm text-ink-muted">
        {rich(
          'labelPreview.encodes',
          {
            value: (
              <span data-testid="label-encodes" className="font-mono font-semibold">
                {code.value}
              </span>
            ),
          },
          {
            type: msg(code.kind === 'barcode' ? 'codeType.barcodeLong' : 'codeType.qr'),
            company: label.companyName,
          },
        )}
      </p>
      <p className="font-semibold text-success">{t('labelPreview.ready')}</p>
      {/* Print uses the SAME label data and generated code; it never registers anything. */}
      <PrintControls label={label} />
      <PrintableLabel label={label} code={code} />
    </div>
  );
}

/**
 * Preview of the label for a NEWLY registered serial. Only ever rendered for 'new' results (a
 * duplicate never reaches this component). The code type comes from the company configuration
 * carried by the result; there is no control to change it here.
 */
export function LabelPreview({ result }: { result: NewSerialResult }) {
  const built = useMemo(() => buildLabelData(result), [result]);
  const [attempt, setAttempt] = useState(0);
  const { t } = useI18n();
  return (
    <section
      aria-label={t('labelPreview.title')}
      data-testid="label-preview"
      className="mt-4 space-y-2"
    >
      <h3 className="text-sm font-extrabold tracking-wide text-ink-muted uppercase">
        {t('labelPreview.title')}
        {built.ok && (
          <span className="ml-2 font-semibold normal-case">
            ({t(codeTypeKey(built.label.codeType))})
          </span>
        )}
      </h3>
      {built.ok ? (
        <LabelWithCode
          key={`${built.label.companyId}|${built.label.codeType}|${built.label.codeValue}|${attempt}`}
          label={built.label}
          onRetry={() => setAttempt((n) => n + 1)}
        />
      ) : (
        <div
          data-testid="label-config-error"
          role="alert"
          className="rounded-lg border-2 border-danger bg-danger-soft p-4"
        >
          {/* The only failure reason is 'code-type-not-configured'. */}
          <p className="text-lg font-bold text-danger">{t('codeType.notConfiguredLong')}</p>
          <p className="mt-1 text-sm">
            {t('labelPreview.notConfiguredBody', { company: result.company.name })}
          </p>
        </div>
      )}
    </section>
  );
}
