import assert from "node:assert/strict"
import { test } from "node:test"
import { norm } from "../src/paths.js"
import { buildPlan } from "../src/plan.js"

const win = process.platform === "win32"
const P = (p) => (win ? `D:\\${p.replace(/\//g, "\\")}` : `/${p}`)

const multi = (id) => ({ id, name: id, capabilities: { read: true, write: true, multiRoot: true }, status: { installed: true, readable: true, writable: true } })
const single = (id) => ({ id, name: id, capabilities: { read: true, write: true, multiRoot: false }, status: { installed: true, readable: true, writable: true } })
const history = (id) => ({ id, name: id, capabilities: { read: true, write: false, multiRoot: false }, status: { installed: true, readable: true, writable: false } })
const snap = (...workspaces) => ({ ok: true, workspaces })
const ws = (name, ...roots) => ({ name, roots: roots.map(P) })
const emptyState = { baseline: null, decided: [] }
const roles = (r) => ({ agents: r, ignore: [] })

test("adds what a template has and a target lacks, and nothing else", () => {
  const plan = buildPlan({
    agents: [multi("a"), multi("b")],
    snapshots: { a: snap(ws("One", "x/one"), ws("Two", "x/two")), b: snap(ws("Two (b)", "x/two")) },
    config: roles({ a: { source: true }, b: { target: true } }),
    state: emptyState,
  })
  assert.deepEqual(plan.items.map((i) => [i.target, i.name]), [["b", "One"]])
})

test("folders count the same however they are spelled", () => {
  const plan = buildPlan({
    agents: [multi("a"), multi("b")],
    snapshots: { a: snap({ name: "One", roots: [P("x/One")] }), b: snap({ name: "one", roots: [P("x/one") + (win ? "\\" : "/")] }) },
    config: roles({ a: { source: true }, b: { target: true } }),
    state: emptyState,
  })
  assert.equal(plan.items.length, 0)
})

test("a project with several folders goes whole to a target that takes several", () => {
  const plan = buildPlan({
    agents: [multi("a"), multi("b")],
    snapshots: { a: snap(ws("Multi", "x/m1", "x/m2")), b: snap() },
    config: roles({ a: { source: true }, b: { target: true } }),
    state: emptyState,
  })
  assert.equal(plan.items.length, 1)
  assert.deepEqual(plan.items[0].roots, [P("x/m1"), P("x/m2")])
})

test("a single-folder target gets one workspace per missing folder", () => {
  const plan = buildPlan({
    agents: [multi("a"), single("d")],
    snapshots: { a: snap(ws("Multi", "x/m1", "x/m2")), d: snap(ws("Already", "x/m2")) },
    config: roles({ a: { source: true }, d: { target: true } }),
    state: emptyState,
  })
  assert.deepEqual(plan.items.map((i) => [i.name, i.roots]), [["Multi", [P("x/m1")]]])
})

test("a template is never a target of itself, and mirroring is symmetric", () => {
  const plan = buildPlan({
    agents: [multi("a"), multi("b")],
    snapshots: { a: snap(ws("OnlyA", "x/a")), b: snap(ws("OnlyB", "x/b")) },
    config: roles({ a: { source: true, target: true }, b: { source: true, target: true } }),
    state: emptyState,
  })
  assert.deepEqual(plan.items.map((i) => `${i.name}>${i.target}`).sort(), ["OnlyA>b", "OnlyB>a"])
})

test("read-only agents are templates only", () => {
  const plan = buildPlan({
    agents: [history("h"), multi("a")],
    snapshots: { h: snap(ws("FromHistory", "x/h")), a: snap() },
    config: roles({ h: { source: true, target: true }, a: { target: true } }),
    state: emptyState,
  })
  assert.deepEqual(plan.items.map((i) => i.target), ["a"])
})

test("folders that don't exist are skipped, ignored ones are reported", () => {
  const plan = buildPlan({
    agents: [multi("a"), multi("b")],
    snapshots: { a: snap(ws("Gone", "x/gone"), ws("Never", "x/never"), ws("Fine", "x/fine")), b: snap() },
    config: { agents: { a: { source: true }, b: { target: true } }, ignore: [P("x/never")] },
    state: emptyState,
    missing: new Set([norm(P("x/gone"))]),
  })
  assert.deepEqual(plan.items.map((i) => i.name), ["Fine"])
  assert.deepEqual(plan.skipped.map((s) => [s.name, s.reason]).sort(), [["Gone", "folder-missing"], ["Never", "ignored"]])
})

test("a target that can't be written to is a note, not a failure", () => {
  const down = { ...multi("b"), status: { installed: true, readable: true, writable: false, reason: "isn't running" } }
  const plan = buildPlan({
    agents: [multi("a"), down],
    snapshots: { a: snap(ws("One", "x/one")), b: snap() },
    config: roles({ a: { source: true }, b: { target: true } }),
    state: emptyState,
  })
  assert.equal(plan.items.length, 0)
  assert.deepEqual(plan.notes.map((n) => [n.agent, n.reason]), [["b", "isn't running"]])
})

test("auto: only what is new since the baseline, and never a decided one", () => {
  const base = {
    agents: [multi("a"), multi("b")],
    snapshots: { a: snap(ws("Old", "x/old"), ws("New", "x/new"), ws("Deleted", "x/deleted")), b: snap() },
    config: roles({ a: { source: true }, b: { target: true } }),
    auto: true,
  }
  const state = { baseline: [norm(P("x/old"))], decided: [`b|${norm(P("x/deleted"))}`] }
  assert.deepEqual(buildPlan({ ...base, state }).items.map((i) => i.name), ["New"])
  // the same difference, asked for by hand, lists all three
  assert.equal(buildPlan({ ...base, auto: false, state }).items.length, 3)
})

test("two templates with the same folder give one item", () => {
  const plan = buildPlan({
    agents: [multi("a"), multi("c"), multi("b")],
    snapshots: { a: snap(ws("One", "x/one")), c: snap(ws("One!", "x/one")), b: snap() },
    config: roles({ a: { source: true }, c: { source: true }, b: { target: true } }),
    state: emptyState,
  })
  assert.equal(plan.items.length, 1)
  assert.deepEqual(plan.items[0].from.sort(), ["a", "c"])
})
