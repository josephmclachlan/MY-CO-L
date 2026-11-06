// Save a file from the browser: a normal download, or the phone's share sheet (WhatsApp, Drive, e-mail).

export function downloadFile(name: string, data: Uint8Array | string, mime: string): void {
  const blob = new Blob([data as BlobPart], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 4000)
}

export function canShareFile(name: string, mime: string): boolean {
  try {
    if (typeof navigator === 'undefined' || !navigator.canShare || !navigator.share) return false
    return navigator.canShare({ files: [new File([''], name, { type: mime })] })
  } catch {
    return false
  }
}

/** Opens the share sheet with the file. Returns false if the person cancelled it. */
export async function shareFile(name: string, data: Uint8Array | string, mime: string): Promise<boolean> {
  try {
    await navigator.share({ files: [new File([data as BlobPart], name, { type: mime })], title: name })
    return true
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return false
    throw e
  }
}
