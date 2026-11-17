// The same sync as tools any agent can call through magpie's MCP server
// (`/mcp/magpie/tools`): "check my workspaces", "sync them", "undo that".
// `run` previews unless told `confirm: true`, so an agent can't change
// anything by asking casually.

const empty = { type: "object", properties: {}, additionalProperties: false }
const SETUP = "Nothing is set up yet: open Workspace Sync in magpie (sidebar → Plugins) and choose a template and the agents to sync into. Until then nothing is synced."

export function createTools(sync) {
  const list = (items) =>
    items.length ? items.map((i) => `- ${i.name} → ${i.targetName}: ${i.roots.join(" ; ")}`).join("\n") : "Nothing to add: the agents are in step."

  return {
    status: {
      description: "Which AI agents (Codex, Antigravity, DeepSeek Harness, Cursor, …) are installed, how many workspaces each has, and the sync settings.",
      args: empty,
      async execute() {
        const s = await sync.status()
        const rows = s.agents.map((a) => {
          const roles = [a.role?.source && "template", a.role?.target && "target"].filter(Boolean).join("+") || "off"
          const state = !a.installed ? "not installed" : a.error ? `unreadable: ${a.error}` : `${a.count} workspaces`
          return `- ${a.name}: ${state}; ${roles}${a.reason && a.installed ? ` (${a.reason})` : ""}`
        })
        return `${rows.join("\n")}\nAuto-sync: ${s.auto.enabled ? `on, every ${s.auto.intervalSec}s` : "off"}`
      },
    },

    plan: {
      description: "Preview what a workspace sync would add to which agent. Changes nothing.",
      args: empty,
      async execute() {
        const p = await sync.plan()
        if (!p.configured) return SETUP
        const extra = [
          ...p.skipped.map((s) => `- skipped ${s.name} for ${s.targetName}: ${s.reason}`),
          ...p.notes.map((n) => `- ${n.agentName}: ${n.reason}`),
        ]
        return `${list(p.items)}${extra.length ? `\n\nNotes:\n${extra.join("\n")}` : ""}`
      },
    },

    run: {
      description:
        "Sync workspaces between the agents chosen in the Workspace Sync page. It only adds, never edits or removes. Without confirm=true it previews only.",
      args: {
        type: "object",
        properties: { confirm: { type: "boolean", description: "true to really add the workspaces; otherwise a preview." } },
        additionalProperties: false,
      },
      async execute({ confirm } = {}) {
        if (confirm !== true) {
          const p = await sync.plan()
          if (!p.configured) return SETUP
          return `Preview only (pass confirm=true to apply):\n${list(p.items)}`
        }
        if (!(await sync.plan()).configured) return SETUP
        const r = await sync.apply({})
        const lines = r.actions.map((a) => `- ${a.ok ? "added" : "FAILED"} ${a.name} → ${sync.byId.get(a.agent)?.name || a.agent}${a.error ? `: ${a.error}` : ""}`)
        return r.actions.length ? `Added ${r.added}, failed ${r.failed}. Run ${r.runId} can be undone.\n${lines.join("\n")}` : "Nothing to add: the agents are in step."
      },
    },

    undo: {
      description: "Take away what the last workspace sync added (or a given run's). Only workspaces that sync made are removed.",
      args: {
        type: "object",
        properties: { runId: { type: "string", description: "A run id from `run`; the latest if omitted." } },
        additionalProperties: false,
      },
      async execute({ runId } = {}) {
        const r = await sync.undo(runId || "")
        return r.reverted.map((x) => `- ${x.ok ? "removed" : "kept"} ${x.name} from ${sync.byId.get(x.agent)?.name || x.agent}${x.error ? `: ${x.error}` : ""}`).join("\n") || "Nothing to undo."
      },
    },
  }
}

