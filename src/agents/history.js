// Agents and editors that remember the folders you opened but have no project
// list to add to: Cursor and VS Code (the "recently opened" list) and Claude
// Code (the folders it was run in). They can be a template, never a target:
// opening a folder is all it takes there, and there is nothing to register.

import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { baseName, display, fromFileUri } from "../paths.js"
import { withDb } from "../sqlite.js"

function userData(dirName) {
  if (process.platform === "win32") return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), dirName)
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Application Support", dirName)
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), dirName)
}

/** Cursor, VS Code and its relatives, from the recently-opened list. */
export function vscodeFamilyAgent({ id, name, dirName, home }) {
  const db = path.join(home || userData(dirName), "User", "globalStorage", "state.vscdb")
  return {
    id,
    name,
    capabilities: { read: true, write: false, multiRoot: false },

    async detect() {
      const installed = fs.existsSync(db)
      return { installed, readable: installed, writable: false, reason: installed ? "history only" : "" }
    },

    async fingerprint() {
      try {
        const s = fs.statSync(db)
        return `${s.size}/${Math.round(s.mtimeMs)}`
      } catch {
        return ""
      }
    },

    async list() {
      const row = await withDb(db, (d) => d.all("select value from ItemTable where key = 'history.recentlyOpenedPathsList'")[0])
      if (!row) return []
      let entries = []
      try {
        entries = JSON.parse(row.value).entries || []
      } catch {
        return []
      }
      return entries
        .map((e) => fromFileUri(e.folderUri))
        .filter(Boolean)
        .map((p) => ({ name: baseName(p), roots: [display(p)] }))
    },
  }
}

/** Claude Code, from the folders in ~/.claude.json. */
export function claudeAgent(opts = {}) {
  const file = opts.file || path.join(os.homedir(), ".claude.json")
  return {
    id: "claude",
    name: "Claude Code",
    capabilities: { read: true, write: false, multiRoot: false },

    async detect() {
      const installed = fs.existsSync(file)
      return { installed, readable: installed, writable: false, reason: installed ? "history only" : "" }
    },

    async fingerprint() {
      try {
        const s = fs.statSync(file)
        return `${s.size}/${Math.round(s.mtimeMs)}`
      } catch {
        return ""
      }
    },

    async list() {
      const doc = JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""))
      return Object.keys(doc.projects || {})
        .map((p) => display(p))
        .filter((p) => p && path.isAbsolute(p))
        .map((p) => ({ name: baseName(p), roots: [p] }))
    },
  }
}
