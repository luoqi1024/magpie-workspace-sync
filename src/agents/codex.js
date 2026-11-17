// Codex (OpenAI): the desktop app and the CLI share one project list in
// <CODEX_HOME>/state_<n>.sqlite (tables `projects` and `project_roots`).
//
// Reading goes straight to that database, read-only. Writing never does: the
// database belongs to Codex, so a project is made, and taken away again, with
// Codex's own app-server (`project/create`, `project/delete`) in a process of
// its own. Codex checks the roots and keeps the positions itself.

import { spawn, spawnSync } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { display, exists } from "../paths.js"
import { withDb } from "../sqlite.js"

const RPC_TIMEOUT_MS = 20000

export function codexAgent(opts = {}) {
  const home = opts.home || process.env.CODEX_HOME || path.join(os.homedir(), ".codex")
  let binCache

  function stateDb() {
    let names = []
    try {
      names = fs.readdirSync(home).filter((f) => /^state_\d+\.sqlite$/.test(f))
    } catch {
      return ""
    }
    names.sort((a, b) => parseInt(b.slice(6), 10) - parseInt(a.slice(6), 10))
    return names.length ? path.join(home, names[0]) : ""
  }

  function findBin() {
    if (binCache !== undefined) return binCache
    const found = candidates().find((c) => runs(c))
    binCache = found || ""
    return binCache
  }

  function candidates() {
    const out = []
    if (opts.bin) out.push(opts.bin)
    if (process.env.CODEX_BIN) out.push(process.env.CODEX_BIN)
    const which = spawnSync(process.platform === "win32" ? "where" : "which", ["codex"], { encoding: "utf8", windowsHide: true })
    if (which.status === 0) out.push(...which.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean))
    if (process.platform === "win32") {
      out.push(...newestUnder(path.join(process.env.LOCALAPPDATA || "", "OpenAI", "Codex", "bin"), (d) => path.join(d, "codex.exe")))
      out.push(...newestUnder("C:\\Program Files\\WindowsApps", (d) => path.join(d, "app", "resources", "codex.exe"), /^OpenAI\.Codex_/))
    } else if (process.platform === "darwin") {
      out.push("/Applications/Codex.app/Contents/Resources/codex")
    }
    return out
  }

  function runs(bin) {
    try {
      return spawnSync(bin, ["--version"], { timeout: 8000, windowsHide: true }).status === 0
    } catch {
      return false
    }
  }

  /** One app-server for the duration of `fn(call)`. */
  async function withServer(fn) {
    const bin = findBin()
    if (!bin) throw new Error("the Codex program wasn't found (set CODEX_BIN)")
    const child = spawn(bin, ["app-server"], {
      env: { ...process.env, CODEX_HOME: home },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    })
    let buf = ""
    let stderr = ""
    let seq = 0
    const waiting = new Map()
    const fail = (err) => {
      for (const w of waiting.values()) w.reject(err)
      waiting.clear()
    }
    child.stdout.on("data", (d) => {
      buf += d
      let i
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim()
        buf = buf.slice(i + 1)
        if (!line) continue
        let m
        try {
          m = JSON.parse(line)
        } catch {
          continue
        }
        const w = m.id !== undefined && waiting.get(m.id)
        if (!w) continue
        waiting.delete(m.id)
        if (m.error) w.reject(new Error(`${w.method}: ${m.error.message || JSON.stringify(m.error)}`))
        else w.resolve(m.result)
      }
    })
    child.stderr.on("data", (d) => {
      stderr = (stderr + d).slice(-400)
    })
    child.on("error", fail)
    child.on("exit", (code) => fail(new Error(`Codex's app-server stopped (${code}) ${stderr.trim()}`.trim())))
    const call = (method, params) =>
      new Promise((resolve, reject) => {
        const id = ++seq
        const timer = setTimeout(() => {
          waiting.delete(id)
          reject(new Error(`${method}: no answer in ${RPC_TIMEOUT_MS / 1000}s`))
        }, RPC_TIMEOUT_MS)
        waiting.set(id, {
          method,
          resolve: (v) => (clearTimeout(timer), resolve(v)),
          reject: (e) => (clearTimeout(timer), reject(e)),
        })
        child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n")
      })
    try {
      await call("initialize", {
        clientInfo: { name: "magpie-workspace-sync", title: "magpie workspace sync", version: "0" },
        capabilities: { experimentalApi: true },
      })
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "initialized" }) + "\n")
      return await fn(call)
    } finally {
      // let it go, and wait for it to be gone: it holds the database files
      const gone = new Promise((resolve) => {
        if (child.exitCode !== null || child.killed) resolve()
        child.once("exit", resolve)
        setTimeout(resolve, 3000).unref?.()
      })
      child.stdin.end()
      child.kill()
      await gone
    }
  }

  return {
    id: "codex",
    name: "Codex",
    capabilities: { read: true, write: true, multiRoot: true },

    async detect() {
      const db = stateDb()
      if (!db) return { installed: await exists(home), readable: false, writable: false, reason: "no project database yet" }
      const bin = findBin()
      return {
        installed: true,
        readable: true,
        writable: !!bin,
        reason: bin ? "" : "the Codex program wasn't found (set CODEX_BIN)",
      }
    },

    async fingerprint() {
      const db = stateDb()
      if (!db) return ""
      return withDb(db, (d) => {
        const p = d.all("select count(*) as n, coalesce(max(updated_at_ms),0) as t from projects")[0]
        const r = d.all("select count(*) as n from project_roots")[0]
        return `${p.n}/${p.t}/${r.n}`
      })
    },

    async list() {
      const db = stateDb()
      if (!db) return []
      return withDb(db, (d) => {
        const roots = new Map()
        for (const r of d.all("select project_id, path from project_roots order by project_id, position")) {
          if (!roots.has(r.project_id)) roots.set(r.project_id, [])
          roots.get(r.project_id).push(display(r.path))
        }
        return d
          .all("select id, name from projects order by position")
          .map((p) => ({ name: p.name, roots: roots.get(p.id) || [], ref: p.id }))
          .filter((p) => p.roots.length)
      })
    },

    async add(items) {
      return withServer(async (call) => {
        const out = []
        for (const it of items) {
          try {
            const res = await call("project/create", {
              idempotencyKey: crypto.randomUUID(),
              name: it.name,
              roots: it.roots.map((p) => ({ path: p })),
            })
            out.push({ ok: true, ref: res.project.id })
          } catch (e) {
            out.push({ ok: false, error: e.message })
          }
        }
        return out
      })
    },

    async remove(refs) {
      return withServer(async (call) => {
        const out = []
        for (const id of refs) {
          try {
            await call("project/delete", { projectId: id })
            out.push({ ok: true })
          } catch (e) {
            out.push({ ok: false, error: e.message })
          }
        }
        return out
      })
    },
  }
}

/** Sub-folders of `dir`, newest first, mapped to a file that must exist. */
function newestUnder(dir, file, match = /./) {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && match.test(e.name))
      .map((e) => {
        const f = file(path.join(dir, e.name))
        try {
          return { f, t: fs.statSync(f).mtimeMs }
        } catch {
          return null
        }
      })
      .filter(Boolean)
      .sort((a, b) => b.t - a.t)
      .map((x) => x.f)
  } catch {
    return []
  }
}
