// Working out what a sync would do. Pure: it takes what the agents list now
// and gives back what to add where. It never reads or writes anything itself,
// so every rule here is tested without an agent installed.
//
// The rules:
//   * Sync only ever ADDS. It never edits, renames or removes a workspace.
//   * A workspace is its folder. The first folder of a project is its identity.
//   * A project is "there" in a target when its first folder is already
//     covered by any project in that target.
//   * A target that takes several folders in one project gets the project
//     whole. One that takes a single folder (DeepSeek Harness) gets one
//     workspace per folder it doesn't have yet.
//   * Folders that no longer exist on disk are skipped, not added.
//   * Automatic sync adds only what appeared after it was turned on, and never
//     one it already decided on (so a workspace you delete stays deleted).

import { baseName, display, norm } from "./paths.js"

/**
 * @param {object} p
 * @param {{id:string,name:string,capabilities:object,status:object}[]} p.agents
 * @param {Record<string,{ok:boolean,workspaces:{name:string,roots:string[]}[]}>} p.snapshots
 * @param {{agents:Record<string,{source?:boolean,target?:boolean}>,ignore?:string[]}} p.config
 * @param {{baseline:string[]|null,decided:string[]}} p.state
 * @param {boolean} [p.auto]
 * @param {Set<string>} [p.missing] normalised folders that don't exist
 */
export function buildPlan({ agents, snapshots, config, state, auto = false, missing = new Set() }) {
  const role = (id) => config.agents?.[id] || {}
  const ignore = new Set((config.ignore || []).map((k) => norm(k)))
  const baseline = new Set(state.baseline || [])
  const decided = new Set(state.decided || [])
  const notes = []
  const skipped = []

  const sources = agents.filter((a) => role(a.id).source && snapshots[a.id]?.ok)
  const targets = agents.filter((a) => role(a.id).target && a.capabilities.write)

  for (const a of agents) {
    if (role(a.id).source && !snapshots[a.id]?.ok) notes.push({ agent: a.id, reason: snapshots[a.id]?.error || a.status.reason || "can't be read" })
  }

  // every project of every template, one entry per first folder
  const candidates = new Map()
  for (const s of sources) {
    for (const w of snapshots[s.id].workspaces) {
      const roots = w.roots.map((r) => display(r)).filter(Boolean)
      if (!roots.length) continue
      const keys = roots.map((r) => norm(r))
      const c = candidates.get(keys[0])
      if (!c) candidates.set(keys[0], { key: keys[0], name: w.name || baseName(roots[0]), roots, keys, from: new Set([s.id]) })
      else {
        c.from.add(s.id)
        if (roots.length > c.roots.length) Object.assign(c, { roots, keys })
      }
    }
  }

  const readyTargets = []
  const items = []
  for (const t of targets) {
    if (!t.status.writable || !snapshots[t.id]?.ok) {
      notes.push({ agent: t.id, reason: t.status.reason || snapshots[t.id]?.error || "can't be written to right now" })
      continue
    }
    readyTargets.push(t.id)
    const covered = new Set(snapshots[t.id].workspaces.flatMap((w) => w.roots.map((r) => norm(r))))
    for (const c of candidates.values()) {
      if (c.from.size === 1 && c.from.has(t.id)) continue
      if (covered.has(c.key)) continue
      if (ignore.has(c.key)) {
        skipped.push({ target: t.id, name: c.name, roots: c.roots, reason: "ignored" })
        continue
      }
      const decideKey = `${t.id}|${c.key}`
      if (auto && (baseline.has(c.key) || decided.has(decideKey))) continue
      if (missing.has(c.key)) {
        skipped.push({ target: t.id, name: c.name, roots: c.roots, reason: "folder-missing" })
        continue
      }
      const live = c.roots.map((r, i) => ({ r, k: c.keys[i] })).filter((x) => !missing.has(x.k))
      const from = [...c.from]
      if (t.capabilities.multiRoot) {
        items.push(item(t, c, c.name, live.map((x) => x.r), decideKey, from))
      } else {
        for (const x of live) {
          if (covered.has(x.k)) continue
          const name = x.k === c.key ? c.name : `${c.name} · ${baseName(x.r)}`
          items.push(item(t, c, name, [x.r], decideKey, from))
        }
      }
    }
  }
  return { items, skipped, notes, targets: readyTargets, configured: sources.length > 0 && targets.length > 0 }
}

function item(target, c, name, roots, decideKey, from) {
  return { id: `${target.id}|${norm(roots[0])}`, target: target.id, name, roots, decideKey, projectKey: c.key, from }
}

/** Every folder any listed workspace has, normalised. */
export function allFolders(snapshots) {
  const out = new Set()
  for (const s of Object.values(snapshots)) {
    if (!s?.ok) continue
    for (const w of s.workspaces) for (const r of w.roots) out.add(norm(r))
  }
  return [...out]
}

