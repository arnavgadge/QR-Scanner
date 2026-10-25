import { dataService } from '../data';
import { useI18n } from '../hooks/useI18n';

const code = (s: string) => <code className="font-mono">{s}</code>;

/** Shown instead of the app when Firebase environment variables are not set. */
export function ConfigMissingScreen() {
  const { t, rich } = useI18n();
  return (
    <main className="mx-auto max-w-xl px-4 py-10">
      <div role="alert" className="rounded-lg border border-danger bg-danger-soft p-6">
        <h1 className="text-2xl font-bold text-danger">{t('configMissing.title')}</h1>
        <p className="mt-2">
          {rich('configMissing.body', {
            example: code('.env.example'),
            local: code('.env.local'),
            flag: code('VITE_USE_FIREBASE_EMULATOR=true'),
            command: code('npm run emulators'),
          })}
        </p>
        <p className="mt-3 font-semibold">{t('configMissing.missing')}</p>
        <ul className="mt-1 list-disc pl-5 font-mono text-sm">
          {dataService.configuration.missing.map((v) => (
            <li key={v}>{v}</li>
          ))}
        </ul>
      </div>
    </main>
  );
}
