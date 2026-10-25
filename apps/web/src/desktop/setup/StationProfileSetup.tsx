import { useState, type FormEvent } from 'react';
import { Button } from '../../components/ui/Button';
import { TextField } from '../../components/ui/TextField';
import { DisplayControls } from '../../features/preferences';
import { useI18n } from '../../hooks/useI18n';
import type { Text } from '../../i18n';
import { desktopBridge } from '../bridge';
import type { StationProfile } from '../protocol';

/** Name given at pairing until this screen is done. */
const PLACEHOLDER_NAME = 'New station';

/**
 * One-time station setup, right after pairing (also the main computer's own station): the
 * station's name (required) and its usual operator (optional). No password: stations never sign
 * in. Afterwards only an administrator can change these (Admin › Stations).
 */
export function StationProfileSetup({
  profile,
  onDone,
}: {
  profile: StationProfile;
  onDone: (profile: StationProfile) => void;
}) {
  const { t, text } = useI18n();
  const [name, setName] = useState(profile.name === PLACEHOLDER_NAME ? '' : profile.name);
  const [operatorName, setOperatorName] = useState(profile.operatorName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Text | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await desktopBridge()!.call('station.setup', { name, operatorName });
    if (r.ok) return onDone(r.data);
    setError(r.error.msg ?? r.error.message);
    setBusy(false);
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col px-4 py-8">
      <div className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold sm:text-3xl">{t('stationSetup.title')}</h1>
        <DisplayControls />
      </div>
      <form
        onSubmit={(e) => void submit(e)}
        noValidate
        className="space-y-4 rounded-lg border border-line bg-surface p-5"
        data-testid="station-setup"
      >
        <p className="text-ink-muted">{t('stationSetup.help')}</p>
        <TextField
          label={t('setup.stationName')}
          hint={t('setup.stationNameHint')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={busy}
          maxLength={60}
          autoFocus
          data-testid="station-setup-name"
        />
        <TextField
          label={t('stationSetup.operator')}
          hint={t('stationSetup.operatorHint')}
          value={operatorName}
          onChange={(e) => setOperatorName(e.target.value)}
          disabled={busy}
          maxLength={60}
          data-testid="station-setup-operator"
        />
        {error && (
          <p role="alert" className="rounded-md bg-danger-soft p-3 font-semibold text-danger">
            {text(error)}
          </p>
        )}
        <Button
          type="submit"
          disabled={busy || !name.trim()}
          className="min-h-14 w-full text-lg"
          data-testid="station-setup-save"
        >
          {t('stationSetup.save')}
        </Button>
      </form>
    </main>
  );
}
