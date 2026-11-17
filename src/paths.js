// Path helpers shared by every adapter.
//
// A workspace is identified by the *normalised* form of its folder (`norm`).
// Two agents that spell the same folder differently (`D:\Dev\x`, `d:/dev/x/`,
// `\\?\D:\dev\x`, `file:///d%3A/dev/x`) must produce the same key, or the sync
// would create duplicates. Display paths (`display`) keep the user's casing.

import fs from "node:fs/promises"
import path from "node:path"

const WIN = process.platform === "win32"

/** The folder as one canonical string for comparisons. */
export function norm(p, { win = WIN } = {}) {
  if (typeof p !== "string") return ""
  let s = p.trim()
  if (!s) return ""
  if (win) {
    s = stripVerbatim(s).replace(/\//g, "\\")
    // keep a leading \\ (UNC), collapse the rest
    const unc = s.startsWith("\\\\")
    s = (unc ? "\\\\" : "") + s.slice(unc ? 2 : 0).replace(/\\{2,}/g, "\\")
    s = s.replace(/^\\\\wsl\$\\/i, "\\\\wsl.localhost\\")
    if (/^[A-Za-z]:\\?$/.test(s)) return s.slice(0, 2).toLowerCase() + "\\"
    s = s.replace(/\\+$/, "")
    return s.toLowerCase()
  }
  s = path.posix.normalize(s)
  if (s.length > 1) s = s.replace(/\/+$/, "")
  return s
}

/** The folder cleaned up for showing and for handing to an agent. */
export function display(p, { win = WIN } = {}) {
  if (typeof p !== "string") return ""
  let s = p.trim()
  if (!s) return ""
  if (win) {
    s = stripVerbatim(s).replace(/\//g, "\\")
    const unc = s.startsWith("\\\\")
    s = (unc ? "\\\\" : "") + s.slice(unc ? 2 : 0).replace(/\\{2,}/g, "\\")
    s = s.replace(/^\\\\wsl\$\\/i, "\\\\wsl.localhost\\")
    if (/^[A-Za-z]:/.test(s)) s = s[0].toUpperCase() + s.slice(1)
    if (!/^[A-Za-z]:\\?$/.test(s)) s = s.replace(/\\+$/, "")
    else if (s.length === 2) s += "\\"
    return s
  }
  s = path.posix.normalize(s)
  return s.length > 1 ? s.replace(/\/+$/, "") : s
}

function stripVerbatim(s) {
  if (/^\\\\\?\\UNC\\/i.test(s)) return "\\\\" + s.slice(8)
  if (/^\\\\\?\\/.test(s)) return s.slice(4)
  return s
}

/** The last folder name, for naming a workspace after its folder. */
export function baseName(p) {
  const s = display(p)
  const parts = s.split(/[\\/]+/).filter(Boolean)
  return parts[parts.length - 1] || s
}

/** `file:///d%3A/dev/x` → `D:\dev\x`; `file://host/share/x` → `\\host\share\x`. */
export function fromFileUri(uri, { win = WIN } = {}) {
  if (typeof uri !== "string" || !/^file:\/\//i.test(uri)) return ""
  let u
  try {
    u = new URL(uri)
  } catch {
    return ""
  }
  let p
  try {
    p = decodeURIComponent(u.pathname)
  } catch {
    return ""
  }
  if (u.host && u.host !== "localhost") {
    return display("\\\\" + u.host + p.replace(/\//g, "\\"), { win: true })
  }
  if (win || /^\/[A-Za-z]:/.test(p)) {
    return display(p.replace(/^\/([A-Za-z]:)/, "$1"), { win: true })
  }
  return display(p, { win: false })
}

/** The inverse of `fromFileUri`, in the form Antigravity writes itself. */
export function toFileUri(p, { win = WIN } = {}) {
  const s = display(p, { win })
  const enc = (seg) => encodeURIComponent(seg)
  if (win && s.startsWith("\\\\")) {
    const [host, ...rest] = s.slice(2).split("\\")
    return "file://" + host + "/" + rest.map(enc).join("/")
  }
  if (win && /^[A-Za-z]:/.test(s)) {
    const [drive, ...rest] = s.split("\\")
    return "file:///" + drive[0].toLowerCase() + "%3A/" + rest.filter(Boolean).map(enc).join("/")
  }
  return "file://" + s.split("/").map((seg, i) => (i === 0 ? "" : enc(seg))).join("/")
}

/** Does the folder exist? A dead network or WSL path must not hang the sync. */
export async function folderExists(p, timeoutMs = 3000) {
  if (!p) return false
  let timer
  try {
    const stat = fs.stat(p).then((s) => s.isDirectory())
    const limit = new Promise((resolve) => {
      timer = setTimeout(() => resolve(false), timeoutMs)
    })
    return await Promise.race([stat, limit])
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

export async function exists(p) {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}
