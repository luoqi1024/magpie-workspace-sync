// Antigravity's language server is faked: a local Connect server that keeps
// project files the way the real one does.
import assert from "node:assert/strict"
import fs from "node:fs"
import http from "node:http"
import path from "node:path"
import { test } from "node:test"
import { antigravityAgent } from "../src/agents/antigravity.js"
import { fromFileUri } from "../src/paths.js"
import { tmp } from "./helpers.js"

async function fake(t, { token = "tok" } = {}) {
  const home = path.join(t.dir, ".gemini")
  const projects = path.join(home, "config", "projects")
  const daemon = path.join(home, "antigravity", "daemon")
  fs.mkdirSync(projects, { recursive: true })
  fs.mkdirSync(daemon, { recursive: true })
  const calls = []
  const server = http.createServer(async (req, res) => {
    let body = ""
    for await (const c of req) body += c
    const method = req.url.split("/").pop()
    calls.push(method)
    if (req.headers["x-codeium-csrf-token"] !== token) return res.writeHead(403).end("{}")
    const b = body ? JSON.parse(body) : {}
    if (method === "CreateProject") fs.writeFileSync(path.join(projects, b.project.id + ".json"), JSON.stringify(b.project))
    if (method === "DeleteProject") {
      if (!b.id) return res.writeHead(400).end('{"code":"invalid_argument"}')
      fs.rmSync(path.join(projects, b.id + ".json"), { force: true })
    }
    const ids = fs.readdirSync(projects).map((f) => f.replace(/\.json$/, ""))
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(method === "ListProjects" ? { projectIds: ids } : {}))
  })
  await new Promise((r) => server.listen(0, "127.0.0.1", r))
  const hub = { pid: process.pid, httpPort: server.address().port, csrfToken: token, lsVersion: "x" }
  fs.writeFileSync(path.join(daemon, "hub_1.json"), JSON.stringify(hub))
  // a leftover of an earlier run: a dead process
  fs.writeFileSync(path.join(daemon, "hub_2.json"), JSON.stringify({ ...hub, pid: 999999, httpPort: 1 }))
  return { home, server, calls, projects }
}

test("adds and removes through the language server, and lists what it wrote", async () => {
  const t = tmp()
  const f = await fake(t)
  try {
    const a = antigravityAgent({ home: f.home })
    assert.equal((await a.detect()).writable, true)
    const folder = path.join(t.dir, "my proj")
    fs.mkdirSync(folder)
    const [r] = await a.add([{ name: "Mine", roots: [folder, path.join(t.dir, "second")] }])
    assert.equal(r.ok, true)
    const listed = await a.list()
    assert.equal(listed.length, 1)
    assert.equal(listed[0].name, "Mine")
    assert.deepEqual(listed[0].roots.map((x) => x.toLowerCase()), [folder, path.join(t.dir, "second")].map((x) => fromFileUri(`file://${x.startsWith("/") ? "" : "/"}${x.replace(/\\/g, "/")}`).toLowerCase()))
    assert.deepEqual(await a.remove([r.ref]), [{ ok: true }])
    assert.equal((await a.list()).length, 0)
  } finally {
    f.server.close()
    t.done()
  }
})

test("not running means not writable, never an error", async () => {
  const t = tmp()
  const f = await fake(t)
  f.server.close()
  try {
    const a = antigravityAgent({ home: f.home })
    const d = await a.detect()
    assert.equal(d.installed, true)
    assert.equal(d.writable, false)
    assert.match(d.reason, /isn't running/)
    assert.deepEqual((await a.add([{ name: "X", roots: [t.dir] }]))[0].ok, false)
  } finally {
    t.done()
  }
})

test("a project with no folder (Antigravity's own) is not listed", async () => {
  const t = tmp()
  const f = await fake(t)
  try {
    fs.writeFileSync(path.join(f.projects, "own.json"), JSON.stringify({ id: "own", name: "swarm/swarm_board", projectResources: {} }))
    assert.deepEqual(await antigravityAgent({ home: f.home }).list(), [])
  } finally {
    f.server.close()
    t.done()
  }
})
