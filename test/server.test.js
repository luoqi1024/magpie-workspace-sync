import assert from "node:assert/strict"
import http from "node:http"
import path from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { createServer } from "../src/server.js"
import { createStore } from "../src/store.js"
import { createSync } from "../src/sync.js"
import { fakeAgent, folder, tmp } from "./helpers.js"

const uiDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "ui")

async function boot() {
  const t = tmp()
  const a = fakeAgent("a", { initial: [{ name: "One", roots: [folder(t.dir, "one")] }] })
  const b = fakeAgent("b")
  const sync = createSync({ agents: [a, b], store: createStore(path.join(t.dir, "data")) })
  await sync.setConfig({ agents: { a: { source: true, target: true }, b: { source: true, target: true } } })
  // port 0 is not usable (the host check names the port), so find a free one
  const probe = (await import("node:net")).createServer()
  await new Promise((r) => probe.listen(0, "127.0.0.1", r))
  const port = probe.address().port
  await new Promise((r) => probe.close(r))
  const srv = createServer({ sync, port, uiDir })
  await srv.listen()
  const base = `http://127.0.0.1:${port}`
  const done = async () => (await srv.close(), t.done())
  try {
    const page = await navigate(base + "/")
    return { t, a, b, srv, base, token: page.body.match(/data-token="([^"]+)"/)[1], page, done }
  } catch (e) {
    await done()
    throw e
  }
}

/** A page load as a browser makes it. (fetch always sends Sec-Fetch-Mode: cors, so it can't.) */
function navigate(url) {
  return new Promise((resolve, reject) => {
    http
      .get(url, { headers: { "sec-fetch-mode": "navigate" } }, (res) => {
        let body = ""
        res.on("data", (c) => (body += c))
        res.on("end", () => resolve({ status: res.statusCode, body, headers: { get: (k) => res.headers[k.toLowerCase()] ?? null } }))
      })
      .on("error", reject)
  })
}
const call = (s, p, body, headers = {}) =>
  fetch(s.base + "/api/" + p, { method: body === undefined ? "GET" : "POST", headers: { "x-wsync-token": s.token, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) })

test("the page is served with a token and a strict policy", async () => {
  const s = await boot()
  try {
    assert.equal(s.page.status, 200)
    assert.match(s.token, /^[0-9a-f-]{36}$/)
    const csp = s.page.headers.get("content-security-policy")
    assert.match(csp, /sandbox allow-scripts/)
    assert.match(csp, /default-src 'none'/)
    assert.equal(s.page.headers.get("access-control-allow-origin"), null, "the HTML that holds the token must not be readable cross-origin")
    assert.equal((await fetch(s.base + "/app.js")).status, 200)
    assert.equal((await fetch(s.base + "/../package.json")).status, 404)
    assert.equal((await fetch(s.base + "/index.html%2f..%2fx")).status, 404)
  } finally {
    await s.done()
  }
})

test("a script's fetch can't read the page (and so its token)", async () => {
  const s = await boot()
  try {
    assert.equal((await fetch(s.base + "/", { headers: { "sec-fetch-mode": "cors" } })).status, 403)
  } finally {
    await s.done()
  }
})

test("the API needs the token and this server's own host", async () => {
  const s = await boot()
  try {
    assert.equal((await fetch(s.base + "/api/state")).status, 403)
    assert.equal((await fetch(s.base + "/api/state", { headers: { "x-wsync-token": "nope" } })).status, 403)
    assert.equal((await call(s, "state")).status, 200)
    // a DNS-rebinding page arrives with another Host
    const http = await import("node:http")
    const status = await new Promise((resolve) => {
      const req = http.request({ host: "127.0.0.1", port: new URL(s.base).port, path: "/api/state", headers: { host: "evil.example", "x-wsync-token": s.token } }, (r) => (r.resume(), resolve(r.statusCode)))
      req.end()
    })
    assert.equal(status, 403)
  } finally {
    await s.done()
  }
})

test("CORS: a sandboxed page (Origin: null) may call the API, preflight included", async () => {
  const s = await boot()
  try {
    const pre = await fetch(s.base + "/api/plan", { method: "OPTIONS", headers: { origin: "null", "access-control-request-method": "POST", "access-control-request-headers": "x-wsync-token, content-type" } })
    assert.equal(pre.status, 204)
    assert.match(pre.headers.get("access-control-allow-headers"), /x-wsync-token/)
    const res = await call(s, "state", undefined, { origin: "null" })
    assert.equal(res.headers.get("access-control-allow-origin"), "*")
  } finally {
    await s.done()
  }
})

test("state, config, plan, apply and undo over HTTP", async () => {
  const s = await boot()
  try {
    const state = await (await call(s, "state")).json()
    assert.deepEqual(state.agents.map((a) => a.id), ["a", "b"])
    assert.equal(state.agents[0].count, 1)
    const plan = await (await call(s, "plan", {})).json()
    assert.equal(plan.items.length, 1)
    assert.equal(plan.items[0].targetName, "b")
    const applied = await (await call(s, "apply", { ids: plan.items.map((i) => i.id) })).json()
    assert.equal(applied.added, 1)
    assert.equal(s.b.items.length, 1)
    assert.equal((await (await call(s, "plan", {})).json()).items.length, 0)
    const undone = await (await call(s, "undo", {})).json()
    assert.equal(undone.reverted[0].ok, true)
    assert.equal(s.b.items.length, 0)
    const cfg = await (await call(s, "config", { auto: { enabled: true, intervalSec: 1 } })).json()
    assert.deepEqual([cfg.auto.enabled, cfg.auto.intervalSec], [true, 5], "the interval has a floor")
    assert.equal((await call(s, "ignore", {})).status, 400)
    assert.equal((await call(s, "nothing", {})).status, 404)
  } finally {
    await s.done()
  }
})

