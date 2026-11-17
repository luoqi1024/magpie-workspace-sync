// The automatic mode: a quiet loop that asks the sync to look. A look costs a
// few file stats when nothing changed (see `tick` in sync.js), so the loop can
// run every few seconds without load.

export function startAuto({ sync, intervalSec, log = () => {} }) {
  let stopped = false
  let timer
  const next = (ms) => {
    if (stopped) return
    timer = setTimeout(loop, ms)
    timer.unref?.()
  }
  async function loop() {
    if (stopped) return
    try {
      await sync.tick()
    } catch (e) {
      log(`auto sync: ${e.message}`)
    }
    next(Math.max(5, intervalSec()) * 1000)
  }
  next(3000)
  return {
    stop() {
      stopped = true
      clearTimeout(timer)
    },
  }
}
