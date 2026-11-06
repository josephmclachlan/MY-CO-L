import { useEffect, useRef, useState } from 'react'
import jsQR from 'jsqr'

/**
 * Reads a QR code from the phone/computer camera. Uses the browser's own BarcodeDetector when it has one,
 * otherwise jsQR on video frames. Also reads a QR from a photo file (for computers without a camera).
 * Calls onText once per code; the parent decides what it means.
 */
type Detector = { detect: (src: CanvasImageSource) => Promise<{ rawValue: string }[]> }
type DetectorCtor = new (o: { formats: string[] }) => Detector

export function Scanner({ onText, onError }: { onText: (t: string) => void; onError: (m: string) => void }) {
  const video = useRef<HTMLVideoElement>(null)
  const cv = useRef<HTMLCanvasElement | null>(null)
  const file = useRef<HTMLInputElement>(null)
  const [on, setOn] = useState(false)
  const stream = useRef<MediaStream | null>(null)
  const raf = useRef(0)
  const last = useRef({ text: '', at: 0 })

  const stop = () => {
    cancelAnimationFrame(raf.current)
    stream.current?.getTracks().forEach((t) => t.stop())
    stream.current = null
    setOn(false)
  }
  useEffect(() => stop, [])

  const emit = (text: string) => {
    const now = Date.now()
    if (text === last.current.text && now - last.current.at < 3000) return
    last.current = { text, at: now }
    onText(text)
  }

  const start = async () => {
    if (!navigator.mediaDevices?.getUserMedia) return onError('THIS BROWSER HAS NO CAMERA ACCESS. USE READ FROM PHOTO OR TYPE THE CODE.')
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
      stream.current = s
      setOn(true)
      await new Promise((r) => setTimeout(r, 0))
      const v = video.current
      if (!v) return stop()
      v.srcObject = s
      await v.play().catch(() => undefined)
      const Det = (window as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector
      const det = Det ? new Det({ formats: ['qr_code'] }) : null
      const c = (cv.current ??= document.createElement('canvas'))
      let busy = false
      const tick = () => {
        raf.current = requestAnimationFrame(tick)
        if (busy || !v.videoWidth) return
        busy = true
        void (async () => {
          try {
            if (det) {
              const r = await det.detect(v)
              if (r[0]?.rawValue) emit(r[0].rawValue)
            } else {
              const w = Math.min(640, v.videoWidth)
              const h = Math.round((v.videoHeight / v.videoWidth) * w)
              c.width = w
              c.height = h
              const ctx = c.getContext('2d', { willReadFrequently: true })!
              ctx.drawImage(v, 0, 0, w, h)
              const q = jsQR(ctx.getImageData(0, 0, w, h).data, w, h)
              if (q?.data) emit(q.data)
            }
          } catch {
            /* a bad frame: try the next one */
          } finally {
            busy = false
          }
        })()
      }
      tick()
    } catch (e) {
      stop()
      const name = e instanceof Error ? e.name : ''
      onError(name === 'NotAllowedError' ? 'CAMERA WAS BLOCKED. ALLOW IT IN THE BROWSER, OR USE READ FROM PHOTO.' : 'NO CAMERA FOUND. USE READ FROM PHOTO OR TYPE THE CODE.')
    }
  }

  const fromFile = async (f: File | undefined) => {
    if (!f) return
    try {
      const bmp = await createImageBitmap(f)
      const side = Math.min(1280, Math.max(bmp.width, bmp.height))
      const k = side / Math.max(bmp.width, bmp.height)
      const w = Math.round(bmp.width * k)
      const h = Math.round(bmp.height * k)
      const c = document.createElement('canvas')
      c.width = w
      c.height = h
      const ctx = c.getContext('2d', { willReadFrequently: true })!
      ctx.drawImage(bmp, 0, 0, w, h)
      const q = jsQR(ctx.getImageData(0, 0, w, h).data, w, h)
      if (q?.data) emit(q.data)
      else onError('NO QR CODE FOUND IN THAT PICTURE. TRY CLOSER AND SQUARE ON.')
    } catch {
      onError('THAT PICTURE COULD NOT BE READ.')
    } finally {
      if (file.current) file.current.value = ''
    }
  }

  return (
    <div className="sc-box">
      <div className="lg-btns">
        {!on ? (
          <button type="button" className="btn on" onClick={() => void start()}>START CAMERA</button>
        ) : (
          <button type="button" className="btn" onClick={stop}>STOP CAMERA</button>
        )}
        <button type="button" className="btn" onClick={() => file.current?.click()}>READ FROM PHOTO</button>
        <input ref={file} type="file" accept="image/*" capture="environment" hidden data-testid="scan-file" onChange={(e) => void fromFile(e.target.files?.[0])} />
      </div>
      {on && (
        <div className="sc-view">
          <video ref={video} playsInline muted />
          <div className="sc-aim" aria-hidden="true" />
        </div>
      )}
    </div>
  )
}
