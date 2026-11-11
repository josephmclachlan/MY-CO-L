// Asks for specimen drawings. A worker thread builds them when the browser has
// one; otherwise they are built here, a few times a second at most.
import { MODELS } from './models'
import { Sketch, type Built } from './sketch'
import { type Fit, fitModel } from './fit'
import BuildWorker from './build.worker?worker&inline'

export type BuildRequest = { kind: 'build'; seq: number; id: string; t: number; detail: number } | { kind: 'fit'; seq: number; id: string; detail: number }
export type BuildReply = { kind: 'built'; seq: number; id: string; b: Built } | { kind: 'fit'; seq: number; id: string; fit: Fit } | { kind: 'error'; seq: number; msg: string }

export class Builder {
  private worker: Worker | null = null
  private sk: Sketch | null = null
  private seq = 0
  private busy = false
  private next: { id: string; t: number; detail: number } | null = null
  /** The last drawing asked for (id, t, detail), so repeats are skipped. */
  last = { id: '', t: -1, detail: -1 }
  onBuilt: (id: string, b: Built) => void = () => {}
  onFit: (id: string, f: Fit) => void = () => {}
  /** Milliseconds the last build took (for the level-of-detail choice). */
  lastMs = 0
  private sentAt = 0

  constructor() {
    try {
      this.worker = new BuildWorker()
      this.worker.onmessage = (e: MessageEvent<BuildReply>) => this.reply(e.data)
      this.worker.onerror = () => this.fallback()
    } catch {
      this.fallback()
    }
  }

  private fallback() {
    this.worker?.terminate()
    this.worker = null
    this.sk = new Sketch()
    // a build that was running in the worker is lost: ask again (unless a newer one waits)
    const lost = this.busy ? this.last : null
    this.busy = false
    this.last = { id: '', t: -1, detail: -1 }
    const n = this.next ?? lost
    this.next = null
    if (n && n.id) this.request(n.id, n.t, n.detail)
  }

  private reply(r: BuildReply) {
    if (r.kind === 'fit') return this.onFit(r.id, r.fit)
    this.busy = false
    this.lastMs = performance.now() - this.sentAt
    if (r.kind === 'built') this.onBuilt(r.id, r.b)
    if (this.next) {
      const n = this.next
      this.next = null
      this.request(n.id, n.t, n.detail)
    }
  }

  fit(id: string, detail: number) {
    if (this.worker) this.worker.postMessage({ kind: 'fit', seq: ++this.seq, id, detail } satisfies BuildRequest)
    else if (MODELS[id]) {
      const f = fitModel(MODELS[id], detail)
      queueMicrotask(() => this.onFit(id, f))
    }
  }

  /** Ask for growth point t. While a build is running only the newest request is kept. */
  request(id: string, t: number, detail: number) {
    const l = this.last
    if (l.id === id && Math.abs(l.t - t) < 1e-5 && l.detail === detail) return
    if (this.busy) {
      this.next = { id, t, detail }
      return
    }
    this.last = { id, t, detail }
    this.busy = true
    this.sentAt = performance.now()
    if (this.worker) {
      this.worker.postMessage({ kind: 'build', seq: ++this.seq, id, t, detail } satisfies BuildRequest)
      return
    }
    // no worker: build here, on the next tick
    setTimeout(() => {
      const m = MODELS[id]
      const sk = this.sk!
      if (m) {
        sk.reset()
        sk.detail = detail
        const f = fitModel(m, detail)
        sk.axis = [f.cx, f.cz]
        m.build(sk, t)
        this.reply({ kind: 'built', seq: this.seq, id, b: sk.export(t) })
      } else this.reply({ kind: 'error', seq: this.seq, msg: 'no model' })
    }, 0)
  }

  get idle() {
    return !this.busy
  }

  dispose() {
    this.worker?.terminate()
    this.worker = null
    this.onBuilt = () => {}
    this.onFit = () => {}
  }
}
