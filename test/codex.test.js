// Needs the real Codex program: it runs Codex's app-server against a throwaway
// CODEX_HOME, so nothing of the user's is touched. Skipped when Codex isn't there.
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { test } from "node:test"
import { codexAgent } from "../src/agents/codex.js"
import { norm } from "../src/paths.js"
import { tmp } from "./helpers.js"

// a database file only has to exist for `detect` to look for the program
const probe = tmp("mws-codexprobe-")
fs.writeFileSync(path.join(probe.dir, "state_5.sqlite"), "")
const bin = (await codexAgent({ home: probe.dir }).detect()).writable
probe.done()

test("creates, lists and deletes a project through Codex's own app-server", { skip: bin ? false : "the Codex program isn't installed", timeout: 90000 }, async () => {
  const t = tmp("mws-codex-")
  try {
    const a = codexAgent({ home: t.dir })
    const one = path.join(t.dir, "one")
    const two = path.join(t.dir, "two")
    fs.mkdirSync(one)
    fs.mkdirSync(two)
    const [r] = await a.add([{ name: "Sync test", roots: [one, two] }])
    assert.equal(r.ok, true, r.error)
    assert.ok(r.ref)
    assert.equal(await a.detect().then((d) => d.readable), true)
    const listed = await a.list()
    assert.equal(listed.length, 1)
    assert.equal(listed[0].name, "Sync test")
    assert.deepEqual(listed[0].roots.map((x) => norm(x)), [one, two].map((x) => norm(x)))
    assert.notEqual(await a.fingerprint(), "")
    assert.deepEqual(await a.remove([r.ref]), [{ ok: true }])
    assert.equal((await a.list()).length, 0)
  } finally {
    t.done()
  }
})
