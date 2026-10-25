import type { I18n } from '../../i18n';

/**
 * Who registered a record, for display: "Station 2 (Ravi)", "Station 2" (no operator set), or just
 * the person's name for records without a station (the web app). Records made before stations
 * replaced operator sign-ins keep the operator name they were stored with.
 */
export function recordedBy(t: I18n['t'], nodeName: string | undefined, personName: string): string {
  if (!nodeName) return personName;
  return personName
    ? t('common.stationWithOperator', { station: nodeName, operator: personName })
    : nodeName;
}
