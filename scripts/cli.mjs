#!/usr/bin/env node
// The sync without magpie: for a look at your machine, or for scripts.
//
//   node scripts/cli.mjs status            agents found, workspace counts, roles
//   node scripts/cli.mjs plan              what a sync would add (changes nothing)
//   node scripts/cli.mjs apply --yes       really add it
//   node scripts/cli.mjs undo              take away what the last apply added
//
// Options: --data <dir>   settings/journal folder (default: magpie's, so the
//                         plugin and this share settings and history)
//          --from a,b     templates (default: the saved roles)
//          --to c,d       targets

import os from "node:os"
import path from "node:path"
import { defaultAgents } from "../src/agents/index.js"
import { createStore } from "../src/store.js"
import { createSync } from "../src/sync.js"

const args = process.argv.slice(2)
const cmd = args[0] || "status"
const opt = (name) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : ""
}
const magpie = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "magpie")
const dataDir = opt("data") || path.join(magpie, "workspace-sync")
const store = createStore(dataDir)
const sync = createSync({ agents: defaultAgents({ dataDir }), store })

const from = opt("from") && opt("from").split(",")
const to = opt("to") && opt("to").split(",")
if (from || to) {
  const patch = {}
  for (const a of sync.byId.values()) patch[a.id] = { source: from ? from.includes(a.id) : undefined, target: to ? to.includes(a.id) : undefined }
  const st = await sync.status()
  for (const a of st.agents) {
    const p = patch[a.id]
    p.source = p.source ?? a.role.source
    p.target = p.target ?? a.role.target
  }
  // for this run only: not saved
  for (const [id, p] of Object.entries(patch)) store.config().agents[id] = p
}

if (cmd === "status") {
  const s = await sync.status()
  for (const a of s.agents) {
    const roles = [a.role?.source && "template", a.role?.target && "target"].filter(Boolean).join("+") || "-"
    const state = !a.installed ? "not installed" : a.error ? `unreadable (${a.error})` : `${a.count} workspaces`
    console.log(`${a.name.padEnd(18)} ${state.padEnd(24)} ${roles.padEnd(16)} ${a.installed && a.reason ? a.reason : ""}`)
  }
  console.log(`auto-sync: ${s.auto.enabled ? `on (${s.auto.intervalSec}s)` : "off"}   data: ${s.dataDir}`)
} else if (cmd === "plan" || (cmd === "apply" && !args.includes("--yes"))) {
  const p = await sync.plan()
  for (const i of p.items) console.log(`+ ${i.targetName.padEnd(18)} ${i.name}  ←  ${i.roots.join(" ; ")}`)
  for (const s of p.skipped) console.log(`  skipped ${s.name} → ${s.targetName}: ${s.reason}`)
  for (const n of p.notes) console.log(`  note: ${n.agentName}: ${n.reason}`)
  console.log(p.items.length ? `${p.items.length} to add${cmd === "apply" ? " (run with --yes to apply)" : ""}` : "in step: nothing to add")
} else if (cmd === "apply") {
  const r = await sync.apply({})
  for (const a of r.actions) console.log(`${a.ok ? "added " : "FAILED"} ${a.agent}: ${a.name}${a.error ? ` (${a.error})` : ""}`)
  console.log(r.actions.length ? `added ${r.added}, failed ${r.failed}, run ${r.runId}` : "in step: nothing to add")
} else if (cmd === "undo") {
  const r = await sync.undo()
  for (const x of r.reverted) console.log(`${x.ok ? "removed" : "kept   "} ${x.agent}: ${x.name}${x.error ? ` (${x.error})` : ""}`)
} else {
  console.error("usage: cli.mjs status | plan | apply --yes | undo   [--data dir] [--from a,b] [--to c,d]")
  process.exit(2)
}
process.exit(0)
