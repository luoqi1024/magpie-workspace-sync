// DeepSeek Harness (DSH): the workspace list is <DSH_HOME>/storages/workspace.json.
//
// DSH has no outside door for this, so the file is edited the way DSH's own
// plugins do: the original is copied away first (the last few are kept), the
// change is written to a temporary file and renamed over it, the file is read
// back, and a file in a layout this code doesn't know (`unit.version` other
// than 2) is never touched.

import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { baseName, display } from "../paths.js"

const SUPPORTED_VERSION = 2
const KEEP_BACKUPS = 10

export function dshAgent(opts = {}) {
  const home = opts.home || process.env.DSH_HOME || path.join(os.homedir(), ".dsh")
  const file = path.join(home, "storages", "workspace.json")
  const backupDir = opts.backupDir || ""

  function read() {
    const raw = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "")
    const doc = JSON.parse(raw)
    if (!doc?.tables?.workspaces || !doc?.global) throw new Error("workspace.json isn't in a layout this plugin knows")
    return doc
  }

  function layoutProblem(doc) {
    const v = doc?.unit?.version
    return v === SUPPORTED_VERSION ? "" : `workspace.json is version ${v}; this plugin knows ${SUPPORTED_VERSION}`
  }

  function backup() {
    if (!backupDir) return ""
    fs.mkdirSync(backupDir, { recursive: true })
    const dest = path.join(backupDir, `workspace-${new Date().toISOString().replace(/[:.]/g, "-")}.json`)
    fs.copyFileSync(file, dest)
    const old = fs.readdirSync(backupDir).filter((f) => /^workspace-.*\.json$/.test(f)).sort()
    for (const f of old.slice(0, Math.max(0, old.length - KEEP_BACKUPS))) fs.rmSync(path.join(backupDir, f), { force: true })
    return dest
  }

  function write(doc) {
    const tmp = file + `.${process.pid}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(doc, null, 2) + "\n", "utf8")
    fs.renameSync(tmp, file)
    JSON.parse(fs.readFileSync(file, "utf8")) // read back
  }

  return {
    id: "dsh",
    name: "DeepSeek Harness",
    capabilities: { read: true, write: true, multiRoot: false },

    async detect() {
      if (!fs.existsSync(file)) return { installed: fs.existsSync(home), readable: false, writable: false, reason: "no workspace.json yet" }
      try {
        const problem = layoutProblem(read())
        return { installed: true, readable: true, writable: !problem, reason: problem }
      } catch (e) {
        return { installed: true, readable: false, writable: false, reason: e.message }
      }
    },

    async fingerprint() {
      try {
        const s = fs.statSync(file)
        return `${s.size}/${Math.round(s.mtimeMs)}`
      } catch {
        return ""
      }
    },

    async list() {
      const doc = read()
      const ids = Array.isArray(doc.global.workspaceIds) ? doc.global.workspaceIds : Object.keys(doc.tables.workspaces)
      return ids
        .map((id) => ({ id, w: doc.tables.workspaces[id] }))
        .filter((x) => x.w?.path)
        .map((x) => ({ name: x.w.title || baseName(x.w.path), roots: [display(x.w.path)], ref: x.id }))
    },

    async add(items) {
      const doc = read()
      const problem = layoutProblem(doc)
      if (problem) return items.map(() => ({ ok: false, error: problem }))
      backup()
      const now = new Date().toISOString()
      const out = items.map((it) => {
        const id = crypto.randomUUID()
        doc.tables.workspaces[id] = { path: it.roots[0], title: it.name, sessionIds: [], createdAt: now, updatedAt: now }
        doc.global.workspaceIds.push(id)
        return { ok: true, ref: id }
      })
      write(doc)
      return out
    },

    async remove(refs) {
      const doc = read()
      backup()
      const out = refs.map((id) => {
        const w = doc.tables.workspaces[id]
        if (!w) return { ok: true } // already gone
        if (w.sessionIds?.length) return { ok: false, error: "it has sessions now, so it was left" }
        delete doc.tables.workspaces[id]
        doc.global.workspaceIds = doc.global.workspaceIds.filter((x) => x !== id)
        return { ok: true }
      })
      write(doc)
      return out
    },
  }
}
