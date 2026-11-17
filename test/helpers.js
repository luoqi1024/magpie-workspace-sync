import fs from "node:fs"
import os from "node:os"
import path from "node:path"

export function tmp(prefix = "mws-") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  return {
    dir,
    done() {
      try {
        // a program that was just stopped can still hold its files for a moment (Windows)
        fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
      } catch {
        // a temp folder left behind is harmless
      }
    },
  }
}

/** A real folder to point a workspace at (the sync skips folders that don't exist). */
export function folder(root, name) {
  const p = path.join(root, name)
  fs.mkdirSync(p, { recursive: true })
  return p
}

/** An in-memory agent that behaves like a real adapter. */
export function fakeAgent(id, { write = true, multiRoot = true, down = false, initial = [] } = {}) {
  let n = 0
  const a = {
    id,
    name: id,
    items: initial.map((w) => ({ ...w, ref: `${id}-${++n}` })),
    down,
    adds: 0,
    capabilities: { read: true, write, multiRoot },
    async detect() {
      return { installed: true, readable: true, writable: write && !a.down, reason: a.down ? "isn't running" : "" }
    },
    async fingerprint() {
      return JSON.stringify(a.items.map((w) => w.ref))
    },
    async list() {
      return a.items.map((w) => ({ name: w.name, roots: [...w.roots], ref: w.ref }))
    },
    async add(items) {
      return items.map((it) => {
        a.adds++
        const ref = `${id}-${++n}`
        a.items.push({ name: it.name, roots: [...it.roots], ref })
        return { ok: true, ref }
      })
    },
    async remove(refs) {
      a.items = a.items.filter((w) => !refs.includes(w.ref))
      return refs.map(() => ({ ok: true }))
    },
  }
  return a
}

