import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { test } from "node:test"
import { claudeAgent, vscodeFamilyAgent } from "../src/agents/history.js"
import { toFileUri } from "../src/paths.js"
import { tmp } from "./helpers.js"

test("Cursor / VS Code: folders from the recently-opened list, nothing else", async () => {
  const t = tmp()
  try {
    const { DatabaseSync } = await import("node:sqlite")
    const gs = path.join(t.dir, "User", "globalStorage")
    fs.mkdirSync(gs, { recursive: true })
    const db = new DatabaseSync(path.join(gs, "state.vscdb"))
    db.exec("create table ItemTable (key text unique, value blob)")
    const folder = path.join(t.dir, "proj")
    db.prepare("insert into ItemTable values (?, ?)").run(
      "history.recentlyOpenedPathsList",
      JSON.stringify({
        entries: [
          { folderUri: toFileUri(folder) },
          { workspace: { id: "x", configPath: "file:///a/b.code-workspace" } },
          { fileUri: "file:///a/readme.md" },
          { folderUri: "vscode-remote://ssh-remote%2Bbox/home/me/p" },
        ],
      }),
    )
    db.close()
    const a = vscodeFamilyAgent({ id: "cursor", name: "Cursor", home: t.dir })
    const d = await a.detect()
    assert.deepEqual([d.installed, d.writable], [true, false])
    const l = await a.list()
    assert.equal(l.length, 1)
    assert.equal(l[0].name, "proj")
    assert.equal(a.capabilities.write, false)
  } finally {
    t.done()
  }
})

test("Cursor: no database means not installed", async () => {
  const t = tmp()
  try {
    assert.equal((await vscodeFamilyAgent({ id: "c", name: "C", home: t.dir }).detect()).installed, false)
  } finally {
    t.done()
  }
})

test("Claude Code: the folders of ~/.claude.json, relative keys ignored", async () => {
  const t = tmp()
  try {
    const f = path.join(t.dir, ".claude.json")
    const proj = path.join(t.dir, "app")
    fs.writeFileSync(f, JSON.stringify({ oauthAccount: { secret: "x" }, projects: { [proj]: {}, "not/absolute": {} } }))
    const l = await claudeAgent({ file: f }).list()
    assert.deepEqual(l.map((w) => w.name), ["app"])
  } finally {
    t.done()
  }
})
