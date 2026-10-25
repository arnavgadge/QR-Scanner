import { Button } from '../../components/ui/Button';
import { useI18n } from '../../hooks/useI18n';
import type { MessageKey } from '../../i18n';

const TIPS: MessageKey[] = [
  'photo.tipBox',
  'photo.tipFocus',
  'photo.tipGlare',
  'photo.tipSteady',
  'photo.tipClose',
  'photo.tipLight',
  'photo.tipCheck',
];

interface Props {
  /** Already translated. */
  notice?: string | undefined;
  onTake: () => void;
  onChoose: () => void;
  onManual: () => void;
}

/** Start of the photo workflow: how to take a useful photo + take / choose buttons. */
export function PhotoCapture({ notice, onTake, onChoose, onManual }: Props) {
  const { t } = useI18n();
  return (
    <section aria-labelledby="photo-title" className="space-y-4">
      <h2 id="photo-title" className="text-lg font-bold">
        {t('photo.title')}
      </h2>

      {/* Visual guide: where the engraving should sit in the photo. */}
      <div
        aria-hidden="true"
        className="flex aspect-[16/7] w-full items-center justify-center rounded-lg border-4 border-dashed border-action bg-action-soft"
      >
        <div className="text-center">
          <p className="text-xs font-semibold tracking-widest text-action uppercase">
            {t('photo.guideArea')}
          </p>
          <p className="mt-1 font-mono text-2xl font-bold text-ink-muted">ABC123456</p>
        </div>
      </div>

      <ul className="list-disc space-y-1 pl-5 text-ink-muted">
        {TIPS.map((key) => (
          <li key={key}>{t(key)}</li>
        ))}
      </ul>

      {notice && (
        <p role="alert" className="rounded-md bg-warn-soft p-3 font-semibold text-warn">
          {notice}
        </p>
      )}

      <div className="flex flex-col gap-3">
        <Button onClick={onTake} className="min-h-16 w-full text-xl md:hidden">
          {t('photo.take')}
        </Button>
        <Button
          variant="secondary"
          onClick={onChoose}
          className="min-h-16 w-full text-xl md:min-h-14 md:text-lg"
        >
          {t('photo.choose')}
        </Button>
        <Button variant="secondary" onClick={onManual} className="min-h-14 w-full text-lg">
          {t('scan.enterManually')}
        </Button>
      </div>
      <p className="text-sm text-ink-muted">{t('photo.help')}</p>
    </section>
  );
}
