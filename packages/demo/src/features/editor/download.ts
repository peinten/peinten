/** Saves a blob through a temporary link, the only way to trigger a download without a server. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = Object.assign(globalThis.document.createElement('a'), { href: url, download: filename });
  link.click();
  // Revoke after the click has been handled; revoking synchronously can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
