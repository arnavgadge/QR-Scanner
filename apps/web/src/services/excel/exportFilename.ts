/** serial-label-export-YYYY-MM-DD.xlsx, using the exporting admin's local calendar date. Pure. */
export function exportFilename(now: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `serial-label-export-${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}.xlsx`;
}
