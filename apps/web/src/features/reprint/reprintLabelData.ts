import { buildLabelData, type LabelData } from '../../services/printing';
import type { FoundSerial } from '../../types';

/** Label data for an already registered serial: the same layout as at registration. */
export function reprintLabelData(found: FoundSerial): LabelData | null {
  if (!found.company) return null;
  const { record } = found;
  const built = buildLabelData({
    result: 'new',
    serial: record.serial,
    company: found.company,
    partNo: record.partNo,
    source: record.source,
    scannedBy: record.scannedBy,
    scannedByName: record.scannedByName,
    scannedAt: record.scannedAt ?? '',
    ...(record.nodeName ? { nodeName: record.nodeName } : {}),
  });
  return built.ok ? built.label : null;
}
