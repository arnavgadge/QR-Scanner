import { useState } from 'react';
import { Button } from '../components/ui/Button';
import { useI18n } from '../hooks/useI18n';

/**
 * The admin password recovery code, shown ONCE (only a scrambled form is kept). With it, a
 * forgotten admin password can be replaced on the main computer or on the backup.
 */
export function RecoveryCodeNotice({ code, onDone }: { code: string; onDone: () => void }) {
  const { t } = useI18n();
  const [noted, setNoted] = useState(false);
  return (
    <section
      aria-labelledby="recovery-title"
      className="space-y-4 rounded-lg border-2 border-warn bg-warn-soft p-5"
      data-testid="recovery-code"
    >
      <h2 id="recovery-title" className="text-xl font-bold">
        {t('recovery.title')}
      </h2>
      <p>{t('recovery.explain')}</p>
      <p
        className="rounded-md border border-line bg-surface p-4 text-center font-mono text-2xl font-bold tracking-wider break-all select-all"
        data-testid="recovery-code-value"
      >
        {code}
      </p>
      <p className="text-sm text-ink-muted">{t('recovery.once')}</p>
      <label className="flex min-h-touch items-center gap-3 font-semibold">
        <input
          type="checkbox"
          className="size-5"
          checked={noted}
          onChange={(e) => setNoted(e.target.checked)}
        />
        {t('recovery.noted')}
      </label>
      <Button onClick={onDone} disabled={!noted} className="min-h-14 w-full text-lg">
        {t('recovery.continue')}
      </Button>
    </section>
  );
}
