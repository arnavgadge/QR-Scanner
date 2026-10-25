import { useConnection } from '../../hooks/useConnection';
import { useI18n } from '../../hooks/useI18n';
import type { MessageKey } from '../../i18n';

const MESSAGES: Record<'offline' | 'connecting' | 'update-required' | 'revoked', MessageKey> = {
  offline: 'status.offline',
  connecting: 'status.connecting',
  'update-required': 'status.updateRequired',
  revoked: 'status.revoked',
};

/**
 * Desktop: the state of the link to the main computer, on every screen. Nothing is shown while
 * connected (and nothing ever in the web app). While it is shown, registering is refused.
 */
export function ConnectionBanner() {
  const state = useConnection();
  const { t } = useI18n();
  if (state === 'online') return null;
  const serious = state !== 'connecting';
  return (
    <div
      role={serious ? 'alert' : 'status'}
      data-testid="connection-banner"
      data-state={state}
      className={`px-4 py-3 text-center text-lg font-bold ${
        serious ? 'bg-danger text-on-accent' : 'bg-warn-soft text-warn'
      }`}
    >
      {t(MESSAGES[state])}
    </div>
  );
}
