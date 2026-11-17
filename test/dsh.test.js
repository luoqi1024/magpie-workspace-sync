import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { test } from "node:test"
import { dshAgent } from "../src/agents/dsh.js"
import { tmp } from "./helpers.js"

function home(t, doc, { bom = false } = {}) {
  const dir = path.join(t.dir, "dsh")
  fs.mkdirSync(path.join(dir, "storages"), { recursive: true })
  fs.writeFileSync(path.join(dir, "storages", "workspace.json"), (bom ? "\uFEFF" : "") + JSON.stringify(doc, null, 2))
  return dir
}
const doc = () => ({
  unit: { name: "workspace", version: 2 },
  global: { initialized: true, workspaceIds: ["w1"], archivedSessionIds: ["s-old"], pinnedSessionIds: [] },
  tables: { workspaces: { w1: { path: "C:\\Users\\me\\Desktop", title: "Desktop", sessionIds: ["s1"], createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" } } },
})

test("lists workspaces, also from a file with a BOM", async () => {
  const t = tmp()
  try {
    const a = dshAgent({ home: home(t, doc(), { bom: true }) })
    assert.deepEqual((await a.list()).map((w) => w.name), ["Desktop"])
    assert.equal((await a.detect()).writable, true)
  } finally {
    t.done()
  }
})

test("add keeps everything else, backs up first, and writes no BOM", async () => {
  const t = tmp()
  try {
    const h = home(t, doc())
    const backupDir = path.join(t.dir, "bk")
    const a = dshAgent({ home: h, backupDir })
    const [r] = await a.add([{ name: "New", roots: ["D:\\x\\new"] }])
    assert.equal(r.ok, true)
    const file = path.join(h, "storages", "workspace.json")
    const raw = fs.readFileSync(file, "utf8")
    assert.notEqual(raw.charCodeAt(0), 0xfeff)
    const out = JSON.parse(raw)
    assert.deepEqual(out.global.workspaceIds, ["w1", r.ref])
    assert.deepEqual(out.global.archivedSessionIds, ["s-old"])
    assert.deepEqual(out.tables.workspaces.w1.sessionIds, ["s1"])
    assert.equal(out.tables.workspaces[r.ref].path, "D:\\x\\new")
    assert.equal(fs.readdirSync(backupDir).length, 1)
    assert.equal(JSON.parse(fs.readFileSync(path.join(backupDir, fs.readdirSync(backupDir)[0]), "utf8")).global.workspaceIds.length, 1)
  } finally {
    t.done()
  }
})

test("remove takes away only an empty workspace", async () => {
  const t = tmp()
  try {
    const h = home(t, doc())
    const a = dshAgent({ home: h, backupDir: path.join(t.dir, "bk") })
    const [added] = await a.add([{ name: "New", roots: ["D:\\x\\new"] }])
    const res = await a.remove([added.ref, "w1"])
    assert.deepEqual(res.map((x) => x.ok), [true, false]) // w1 has a session
    assert.deepEqual((await a.list()).map((w) => w.name), ["Desktop"])
  } finally {
    t.done()
  }
})

test("a layout it doesn't know is never written", async () => {
  const t = tmp()
  try {
    const d = doc()
    d.unit.version = 3
    const a = dshAgent({ home: home(t, d), backupDir: path.join(t.dir, "bk") })
    assert.equal((await a.detect()).writable, false)
    const [r] = await a.add([{ name: "New", roots: ["D:\\x"] }])
    assert.equal(r.ok, false)
    assert.equal(JSON.parse(fs.readFileSync(path.join(t.dir, "dsh", "storages", "workspace.json"), "utf8")).unit.version, 3)
  } finally {
    t.done()
  }
})
