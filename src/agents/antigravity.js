// Antigravity (Google): projects are files in ~/.gemini/config/projects/<id>.json,
// owned by Antigravity's language server. Reading is those files. Writing is
// the language server's own `CreateProject` / `DeleteProject`, on its local
// Connect endpoint, which needs Antigravity to be running. The endpoint and
// its CSRF token come from the daemon's ~/.gemini/antigravity/daemon/hub_*.json
// (stale ones of earlier runs stay behind, so each is checked for a live
// process and a real answer).

import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { baseName, display, fromFileUri, toFileUri } from "../paths.js"

const SERVICE = "exa.language_server_pb.LanguageServerService"

export function antigravityAgent(opts = {}) {
  const home = opts.home || path.join(os.homedir(), ".gemini")
  const projectsDir = path.join(home, "config", "projects")
  const daemonDir = path.join(home, "antigravity", "daemon")

  function alive(pid) {
    try {
      process.kill(pid, 0)
      return true
    } catch (e) {
      return e.code === "EPERM"
    }
  }

  function hubs() {
    try {
      return fs
        .readdirSync(daemonDir)
        .filter((f) => /^hub_\d+\.json$/.test(f))
        .map((f) => {
          try {
            const p = path.join(daemonDir, f)
            return { ...JSON.parse(fs.readFileSync(p, "utf8")), t: fs.statSync(p).mtimeMs }
          } catch {
            return null
          }
        })
        .filter((h) => h && h.httpPort && h.csrfToken && alive(h.pid))
        .sort((a, b) => b.t - a.t)
    } catch {
      return []
    }
  }

  async function rpc(hub, method, body) {
    const res = await fetch(`http://127.0.0.1:${hub.httpPort}/${SERVICE}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json", "connect-protocol-version": "1", "x-codeium-csrf-token": hub.csrfToken },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    })
    const text = await res.text()
    if (!res.ok) throw new Error(`${method}: ${text.slice(0, 200)}`)
    return text ? JSON.parse(text) : {}
  }

  /** The running language server, or null. */
  async function server() {
    for (const h of hubs()) {
      try {
        await rpc(h, "ListProjects", {})
        return h
      } catch {
        // an earlier run's leftovers
      }
    }
    return null
  }

  return {
    id: "antigravity",
    name: "Antigravity",
    capabilities: { read: true, write: true, multiRoot: true },

    async detect() {
      if (!fs.existsSync(projectsDir) && !fs.existsSync(path.join(home, "antigravity"))) {
        return { installed: false, readable: false, writable: false, reason: "" }
      }
      const live = await server()
      return {
        installed: true,
        readable: fs.existsSync(projectsDir),
        writable: !!live,
        reason: live ? "" : "Antigravity isn't running (open it to add projects)",
      }
    },

    async fingerprint() {
      try {
        return fs
          .readdirSync(projectsDir)
          .filter((f) => f.endsWith(".json"))
          .map((f) => {
            const s = fs.statSync(path.join(projectsDir, f))
            return `${f}:${s.size}:${Math.round(s.mtimeMs)}`
          })
          .sort()
          .join("|")
      } catch {
        return ""
      }
    },

    async list() {
      let files = []
      try {
        files = fs.readdirSync(projectsDir).filter((f) => f.endsWith(".json"))
      } catch {
        return []
      }
      const out = []
      for (const f of files) {
        try {
          const j = JSON.parse(fs.readFileSync(path.join(projectsDir, f), "utf8").replace(/^\uFEFF/, ""))
          const roots = (j.projectResources?.resources || []).map((r) => fromFileUri(r.folderUri)).filter(Boolean)
          if (roots.length) out.push({ name: j.name || baseName(roots[0]), roots, ref: j.id || f.replace(/\.json$/, "") })
        } catch {
          // a file being written; the next look gets it
        }
      }
      return out
    },

    async add(items) {
      const hub = await server()
      if (!hub) return items.map(() => ({ ok: false, error: "Antigravity isn't running" }))
      const out = []
      for (const it of items) {
        const id = crypto.randomUUID()
        try {
          await rpc(hub, "CreateProject", {
            project: {
              id,
              name: it.name,
              projectResources: { resources: it.roots.map((r) => ({ folderUri: toFileUri(r) })) },
              backendType: "BACKEND_TYPE_LOCAL",
            },
            backend: "BACKEND_TYPE_LOCAL",
          })
          const { projectIds = [] } = await rpc(hub, "ListProjects", {})
          out.push(projectIds.includes(id) ? { ok: true, ref: id } : { ok: false, error: "it was accepted but isn't listed" })
        } catch (e) {
          out.push({ ok: false, error: e.message })
        }
      }
      return out
    },

    async remove(refs) {
      const hub = await server()
      if (!hub) return refs.map(() => ({ ok: false, error: "Antigravity isn't running" }))
      const out = []
      for (const id of refs) {
        try {
          await rpc(hub, "DeleteProject", { id })
          out.push({ ok: true })
        } catch (e) {
          out.push({ ok: false, error: e.message })
        }
      }
      return out
    },
  }
}
