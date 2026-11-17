// Read-only SQLite for the agents that keep their project list in a database.
//
// Inside magpie's plugin host (Bun) `bun:sqlite` is built in. Under Node 22+
// (tests, scripts) `node:sqlite` takes its place. Neither needs an install, so
// the plugin stays dependency-free (magpie runs install scripts never).

import fs from "node:fs"
import os from "node:os"
import path from "node:path"

/** Open `file` read-only. Resolves to `{ all(sql, ...params), close() }`. */
export async function openReadonly(file) {
  try {
    const { Database } = await import("bun:sqlite")
    const db = new Database(file, { readonly: true })
    return { all: (sql, ...p) => db.query(sql).all(...p), close: () => db.close() }
  } catch (e) {
    if (!isMissingModule(e) && !/bun:sqlite/.test(String(e?.message))) throw e
  }
  const { DatabaseSync } = await import("node:sqlite")
  const db = new DatabaseSync(file, { readOnly: true })
  return { all: (sql, ...p) => db.prepare(sql).all(...p), close: () => db.close() }
}

function isMissingModule(e) {
  return e?.code === "ERR_UNSUPPORTED_ESM_URL_SCHEME" || e?.code === "ERR_MODULE_NOT_FOUND" || e?.code === "MODULE_NOT_FOUND"
}

/**
 * Run `fn(db)` on `file`. A database another process keeps locked or half
 * written is read from a copy of the file and its -wal, so one read can never
 * disturb the owner.
 */
export async function withDb(file, fn) {
  try {
    const db = await openReadonly(file)
    try {
      return await fn(db)
    } finally {
      db.close()
    }
  } catch (first) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mws-db-"))
    try {
      const copy = path.join(dir, path.basename(file))
      fs.copyFileSync(file, copy)
      for (const ext of ["-wal", "-shm"]) {
        if (fs.existsSync(file + ext)) fs.copyFileSync(file + ext, copy + ext)
      }
      const db = await openReadonly(copy)
      try {
        return await fn(db)
      } finally {
        db.close()
      }
    } catch {
      throw first
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  }
}
