// The plugin's page is a small web app served from the plugin host, on
// 127.0.0.1 (magpie's `magpie.page.service`). magpie's window loads it in a
// sandboxed frame; `magpie web` passes it through to a browser on another
// computer.
//
// Anything on this computer can reach a port on 127.0.0.1, including web
// pages in the user's browser, so the API is shut three ways:
//   * Host must be this server's own address (no DNS rebinding);
//   * every /api call carries a token that only the page's own HTML holds;
//   * that HTML is given out to a page load only, never to a script's fetch
//     (Sec-Fetch-Mode), and carries no CORS header, so another site can't
//     read the token out of it.

import crypto from "node:crypto"
import fs from "node:fs"
import http from "node:http"
import path from "node:path"

const MIME = { ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".html": "text/html; charset=utf-8" }

export function createServer({ sync, port, uiDir, log = () => {} }) {
  const token = crypto.randomUUID()
  const hostOk = new RegExp(`^(127\\.0\\.0\\.1|localhost|\\[::1\\]):${port}$`)

  const send = (res, status, body, headers = {}) => {
    res.writeHead(status, { "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", ...headers })
    res.end(body)
  }
  const json = (res, status, obj) => send(res, status, JSON.stringify(obj), { "content-type": "application/json; charset=utf-8", ...cors })
  const cors = {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type, x-wsync-token",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-max-age": "600",
  }
  const csp = [
    "sandbox allow-scripts",
    "default-src 'none'",
    `script-src 'self' http://127.0.0.1:${port}`,
    `style-src 'self' http://127.0.0.1:${port} 'unsafe-inline'`,
    "img-src 'self' data:",
    `connect-src 'self' http://127.0.0.1:${port}`,
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ")

  async function body(req) {
    let size = 0
    const chunks = []
    for await (const c of req) {
      size += c.length
      if (size > 1_000_000) throw new Error("body too large")
      chunks.push(c)
    }
    const text = Buffer.concat(chunks).toString("utf8")
    return text ? JSON.parse(text) : {}
  }

  async function api(req, res, route) {
    if (req.headers["x-wsync-token"] !== token) return json(res, 403, { error: "missing or wrong token: reload the page" })
    try {
      if (route === "state" && req.method === "GET") return json(res, 200, await sync.status())
      if (req.method !== "POST") return json(res, 405, { error: "POST expected" })
      const b = await body(req)
      switch (route) {
        case "config":
          await sync.setConfig(b)
          return json(res, 200, await sync.status())
        case "plan":
          return json(res, 200, await sync.plan())
        case "apply":
          return json(res, 200, await sync.apply({ ids: Array.isArray(b.ids) ? b.ids : null }))
        case "undo":
          return json(res, 200, await sync.undo(typeof b.runId === "string" ? b.runId : ""))
        case "ignore":
          if (typeof b.folder !== "string" || !b.folder) return json(res, 400, { error: "folder is required" })
          await sync.ignore(b.folder, b.on !== false)
          return json(res, 200, { ok: true })
        default:
          return json(res, 404, { error: "no such call" })
      }
    } catch (e) {
      log(`api ${route}: ${e.message}`)
      return json(res, 500, { error: e.message })
    }
  }

  function page(req, res, name) {
    const file = path.join(uiDir, name)
    if (!file.startsWith(uiDir + path.sep) && file !== uiDir) return send(res, 404, "not found")
    let data
    try {
      data = fs.readFileSync(file)
    } catch {
      return send(res, 404, "not found")
    }
    const headers = { "content-type": MIME[path.extname(name)] || "application/octet-stream", "content-security-policy": csp }
    if (name === "index.html") {
      const mode = req.headers["sec-fetch-mode"]
      if (mode && mode !== "navigate") return send(res, 403, "the page is for a page load only")
      data = data.toString("utf8").replace("__WSYNC_TOKEN__", token)
    }
    send(res, 200, data, headers)
  }

  const server = http.createServer((req, res) => {
    if (!hostOk.test(req.headers.host || "")) return send(res, 403, "wrong host")
    const url = new URL(req.url, "http://x")
    const p = decodeURIComponent(url.pathname)
    if (p.startsWith("/api/")) {
      if (req.method === "OPTIONS") return send(res, 204, "", cors)
      return api(req, res, p.slice(5))
    }
    if (req.method !== "GET") return send(res, 405, "GET expected")
    const name = p === "/" ? "index.html" : p.slice(1)
    if (!/^[\w.-]+$/.test(name)) return send(res, 404, "not found")
    return page(req, res, name)
  })

  let closed = false
  /** Listens, and goes on trying while the port is held (a host that is restarting still has it). */
  function listen(waitMs = 3000) {
    return new Promise((resolve) => {
      const done = setTimeout(resolve, waitMs)
      const attempt = () => {
        if (closed) return resolve()
        server.once("error", (e) => {
          if (e.code === "EADDRINUSE" || e.code === "EACCES") setTimeout(attempt, 500).unref?.()
          else log(`service: ${e.message}`)
        })
        server.listen(port, "127.0.0.1", () => {
          clearTimeout(done)
          resolve()
        })
      }
      attempt()
    })
  }

  return {
    listen,
    token,
    server,
    close() {
      closed = true
      // a page left open keeps its connection; a reload must free the port now
      return new Promise((r) => {
        if (!server.listening) return r()
        server.close(() => r())
        server.closeAllConnections?.()
      })
    },
  }
}
