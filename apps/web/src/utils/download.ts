/** Triggers a normal browser download of an in-memory file. Nothing is uploaded or stored. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    // Give the browser time to start the download before releasing the object URL.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}
