// Settings and bookkeeping, as two small JSON files in the plugin's folder
// under magpie's config directory. Both are written whole to a temporary file
// and renamed, so a crash never leaves half a file, and an unreadable file is
// set aside (never overwritten) before defaults take its place.

import fs from "node:fs"
import path from "node:path"

export const DEFAULT_CONFIG = {
  version: 1,
  // agent id -> { source: use its workspaces as a template, target: add to it }
  agents: {},
  auto: { enabled: false, intervalSec: 20 },
  // normalised folders that are never synced anywhere
  ignore: [],
}

export const DEFAULT_STATE = {
  version: 1,
  // folders that already existed when auto-sync was turned on: not "new"
  baseline: null,
  baselineAt: "",
  // "<agent>|<folder>" the sync already decided on (added, or left out on
  // purpose), so a deleted workspace is never brought back by itself
  decided: [],
  history: [],
}

const MAX_HISTORY = 30

export function createStore(dir) {
  fs.mkdirSync(dir, { recursive: true })
  const files = { config: path.join(dir, "config.json"), state: path.join(dir, "state.json") }
  const defaults = { config: DEFAULT_CONFIG, state: DEFAULT_STATE }
  const cache = {}

  function load(name) {
    if (cache[name]) return cache[name]
    let value = structuredClone(defaults[name])
    try {
      const raw = fs.readFileSync(files[name], "utf8").replace(/^\uFEFF/, "")
      value = { ...value, ...JSON.parse(raw) }
    } catch (e) {
      if (e.code !== "ENOENT") {
        try {
          fs.renameSync(files[name], files[name] + `.broken-${Date.now()}`)
        } catch {
          // leave it
        }
      }
    }
    cache[name] = value
    return value
  }

  function save(name) {
    const tmp = files[name] + `.${process.pid}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(cache[name], null, 2) + "\n", "utf8")
    fs.renameSync(tmp, files[name])
  }

  return {
    dir,
    config: () => load("config"),
    state: () => load("state"),
    saveConfig: () => save("config"),
    saveState() {
      const s = load("state")
      s.history = s.history.slice(0, MAX_HISTORY)
      save("state")
    },
  }
}
