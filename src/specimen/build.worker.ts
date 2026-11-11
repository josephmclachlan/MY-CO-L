// Builds specimen drawings off the main thread, so the wireframe keeps turning
// smoothly while a growth animation rebuilds the model many times a second.
import { MODELS } from './models'
import { Sketch } from './sketch'
import { fitModel } from './fit'
import type { BuildRequest, BuildReply } from './builder'

const sk = new Sketch()

self.onmessage = (e: MessageEvent<BuildRequest>) => {
  const q = e.data
  const m = MODELS[q.id]
  if (!m) {
    const r: BuildReply = { kind: 'error', seq: q.seq, msg: `no model ${q.id}` }
    postMessage(r)
    return
  }
  try {
    if (q.kind === 'fit') {
      const r: BuildReply = { kind: 'fit', seq: q.seq, id: q.id, fit: fitModel(m, q.detail) }
      postMessage(r)
      return
    }
    sk.reset()
    sk.detail = q.detail
    const f = fitModel(m, q.detail)
    sk.axis = [f.cx, f.cz]
    m.build(sk, q.t)
    const b = sk.export(q.t)
    const r: BuildReply = { kind: 'built', seq: q.seq, id: q.id, b }
    ;(self as unknown as Worker).postMessage(r, [b.lp.buffer, b.ln.buffer, b.li.buffer, b.op.buffer, b.oi.buffer])
  } catch (err) {
    const r: BuildReply = { kind: 'error', seq: q.seq, msg: String(err) }
    postMessage(r)
  }
}
