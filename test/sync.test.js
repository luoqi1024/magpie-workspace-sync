import assert from "node:assert/strict"
import { test } from "node:test"
import { createStore } from "../src/store.js"
import { createSync } from "../src/sync.js"
import { fakeAgent, folder, tmp } from "./helpers.js"

/** Every agent a template and a target, as the "Mirror all" button sets it. */
async function setup(agents) {
  const t = tmp()
  const store = createStore(t.dir + "/data")
  const sync = createSync({ agents, store })
  await sync.setConfig({ agents: Object.fromEntries(agents.map((a) => [a.id, { source: true, target: true }])) })
  return { t, store, sync }
}

test("manual sync: preview, apply the chosen ones, leave the rest decided", async () => {
  const t = tmp()
  const a1 = folder(t.dir, "one"), a2 = folder(t.dir, "two")
  const a = fakeAgent("a", { initial: [{ name: "One", roots: [a1] }, { name: "Two", roots: [a2] }] })
  const b = fakeAgent("b")
  const s = await setup([a, b])
  try {
    const plan = await s.sync.plan()
    assert.equal(plan.items.length, 2)
    const one = plan.items.find((i) => i.name === "One")
    const res = await s.sync.apply({ ids: [one.id] })
    assert.equal(res.added, 1)
    assert.deepEqual(b.items.map((w) => w.name), ["One"])
    // what was left out stays listed for another manual run
    assert.equal((await s.sync.plan()).items.length, 1)
  } finally {
    s.t.done()
    t.done()
  }
})

test("undo removes exactly what the run added", async () => {
  const t = tmp()
  const f = folder(t.dir, "p")
  const a = fakeAgent("a", { initial: [{ name: "P", roots: [f] }] })
  const b = fakeAgent("b", { initial: [{ name: "Mine", roots: [folder(t.dir, "mine")] }] })
  const s = await setup([a, b])
  try {
    await s.sync.apply({}) // both agents are templates and targets: each gets the other's
    assert.equal(b.items.length, 2)
    assert.equal(a.items.length, 2)
    const r = await s.sync.undo()
    assert.deepEqual(r.reverted.map((x) => x.ok), [true, true])
    assert.deepEqual(b.items.map((w) => w.name), ["Mine"])
    assert.deepEqual(a.items.map((w) => w.name), ["P"])
    await assert.rejects(() => s.sync.undo(), /nothing to undo/)
  } finally {
    s.t.done()
    t.done()
  }
})

test("a read-only agent can be a template but is never written to", async () => {
  const t = tmp()
  const h = fakeAgent("h", { write: false, initial: [{ name: "FromHistory", roots: [folder(t.dir, "h")] }] })
  const b = fakeAgent("b")
  const s = await setup([h, b])
  try {
    await s.sync.setConfig({ agents: { h: { source: true, target: true }, b: { source: false, target: true } } })
    const res = await s.sync.apply({})
    assert.equal(res.added, 1)
    assert.equal(h.adds, 0)
  } finally {
    s.t.done()
    t.done()
  }
})

test("auto: nothing existing is synced, a new workspace is, and a deleted one stays deleted", async () => {
  const t = tmp()
  const old = folder(t.dir, "old")
  const a = fakeAgent("a", { initial: [{ name: "Old", roots: [old] }] })
  const b = fakeAgent("b")
  const s = await setup([a, b])
  try {
    await s.sync.setConfig({ auto: { enabled: true } }) // takes the baseline
    await s.sync.tick()
    assert.equal(b.items.length, 0, "existing workspaces are left to a manual sync")

    const fresh = folder(t.dir, "fresh")
    a.items.push({ name: "Fresh", roots: [fresh], ref: "a-new" })
    const r = await s.sync.tick()
    assert.equal(r.added, 1)
    assert.deepEqual(b.items.map((w) => w.name), ["Fresh"])

    // the user deletes it from b: auto must not bring it back
    b.items = []
    await s.sync.tick()
    await s.sync.tick()
    assert.equal(b.items.length, 0)
  } finally {
    s.t.done()
    t.done()
  }
})

test("auto: a target that is down is retried until it comes up", async () => {
  const t = tmp()
  const a = fakeAgent("a")
  const b = fakeAgent("b", { down: true })
  const s = await setup([a, b])
  try {
    await s.sync.setConfig({ auto: { enabled: true } })
    a.items.push({ name: "New", roots: [folder(t.dir, "new")], ref: "a-new" })
    await s.sync.tick()
    assert.equal(b.items.length, 0)
    b.down = false
    await s.sync.tick()
    assert.deepEqual(b.items.map((w) => w.name), ["New"])
  } finally {
    s.t.done()
    t.done()
  }
})

test("auto: unchanged agents cost no listing", async () => {
  const t = tmp()
  const a = fakeAgent("a", { initial: [{ name: "X", roots: [folder(t.dir, "x")] }] })
  const b = fakeAgent("b")
  let lists = 0
  const list = a.list.bind(a)
  a.list = async () => (lists++, list())
  const s = await setup([a, b])
  try {
    await s.sync.setConfig({ auto: { enabled: true } })
    await s.sync.tick()
    const before = lists
    assert.deepEqual(await s.sync.tick(), { skipped: "unchanged" })
    assert.equal(lists, before)
  } finally {
    s.t.done()
    t.done()
  }
})

test("a folder set to never sync is not offered again", async () => {
  const t = tmp()
  const f = folder(t.dir, "secret")
  const a = fakeAgent("a", { initial: [{ name: "Secret", roots: [f] }] })
  const b = fakeAgent("b")
  const s = await setup([a, b])
  try {
    await s.sync.ignore(f, true)
    const p = await s.sync.plan()
    assert.equal(p.items.length, 0)
    assert.equal(p.skipped[0].reason, "ignored")
    await s.sync.ignore(f, false)
    assert.equal((await s.sync.plan()).items.length, 1)
  } finally {
    s.t.done()
    t.done()
  }
})

test("settings survive a restart, and a broken file is set aside, not overwritten", async () => {
  const t = tmp()
  try {
    const dir = t.dir + "/d"
    let store = createStore(dir)
    store.config().auto.enabled = true
    store.saveConfig()
    store = createStore(dir)
    assert.equal(store.config().auto.enabled, true)
    const fs = await import("node:fs")
    fs.writeFileSync(dir + "/config.json", "{ not json")
    store = createStore(dir)
    assert.equal(store.config().auto.enabled, false)
    assert.ok(fs.readdirSync(dir).some((f) => f.startsWith("config.json.broken-")))
  } finally {
    t.done()
  }
})


test("nothing is synced until the user has chosen: a first run never writes", async () => {
  const t = tmp()
  const a = fakeAgent("a", { initial: [{ name: "One", roots: [folder(t.dir, "one")] }] })
  const b = fakeAgent("b")
  const store = createStore(t.dir + "/data")
  const sync = createSync({ agents: [a, b], store })
  try {
    const p = await sync.plan()
    assert.equal(p.configured, false)
    assert.equal(p.items.length, 0)
    assert.deepEqual((await sync.apply({})).actions, [])
    assert.equal(b.items.length, 0)
    await sync.setConfig({ agents: { a: { source: true }, b: { target: true } } })
    assert.equal((await sync.plan()).configured, true)
  } finally {
    t.done()
  }
})
