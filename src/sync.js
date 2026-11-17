// The sync itself: looks at the agents, plans (plan.js), applies, keeps a
// journal of what it added so a run can be undone, and drives the automatic
// mode. One lock makes a manual run and an automatic tick take turns.

import crypto from "node:crypto"
import { folderExists, norm } from "./paths.js"
import { allFolders, buildPlan } from "./plan.js"

const EXISTS_TTL_MS = 60_000

// Map.groupBy, for a runtime that doesn't have it yet
function groupBy(list, key) {
  const m = new Map()
  for (const x of list) {
    const k = key(x)
    if (!m.has(k)) m.set(k, [])
    m.get(k).push(x)
  }
  return m
}

export function createSync({ agents, store, log = () => {}, exists = folderExists }) {
  const byId = new Map(agents.map((a) => [a.id, a]))
  const cache = new Map() // agent id -> { fp, snap }
  const existsCache = new Map() // normalised folder -> { at, ok }
  let chain = Promise.resolve()
  let lastFp = ""
  let retry = false
  const auto = { lastCheck: "", lastResult: "", error: "", checking: false }

  const locked = (fn) => {
    const run = chain.then(fn, fn)
    chain = run.catch(() => {})
    return run
  }

  const config = () => store.config()
  const state = () => store.state()

  /**
   * The roles of an agent: what the user set. Nothing is a template or a target
   * until they choose, so a first run (or an agent calling the tools) never
   * writes anywhere on its own.
   */
  function roleOf(a) {
    const set = config().agents[a.id]
    if (set) return { source: !!set.source && a.capabilities.read, target: !!set.target && a.capabilities.write }
    return { source: false, target: false }
  }

  function effectiveConfig() {
    const agentsCfg = {}
    for (const a of agents) agentsCfg[a.id] = roleOf(a)
    return { ...config(), agents: agentsCfg }
  }

  async function status1(a) {
    let st
    try {
      st = await a.detect()
    } catch (e) {
      st = { installed: false, readable: false, writable: false, reason: e.message }
    }
    return { id: a.id, name: a.name, capabilities: a.capabilities, status: st }
  }

  /** What each agent lists now. Reuses the last listing while its fingerprint holds. */
  async function snapshots(infos, { force = false } = {}) {
    const out = {}
    await Promise.all(
      infos.map(async (a) => {
        const adapter = byId.get(a.id)
        if (!a.status.installed || !a.status.readable) {
          out[a.id] = { ok: false, error: a.status.reason || "not installed", workspaces: [] }
          return
        }
        try {
          const fp = await adapter.fingerprint()
          const hit = cache.get(a.id)
          if (!force && hit && hit.fp === fp && fp !== "") {
            out[a.id] = hit.snap
            return
          }
          const snap = { ok: true, workspaces: await adapter.list() }
          cache.set(a.id, { fp, snap })
          out[a.id] = snap
        } catch (e) {
          out[a.id] = { ok: false, error: e.message, workspaces: [] }
        }
      }),
    )
    return out
  }

  async function missingFolders(snaps, cfg) {
    const wanted = new Map()
    for (const [id, s] of Object.entries(snaps)) {
      if (!cfg.agents[id]?.source || !s.ok) continue
      for (const w of s.workspaces) for (const r of w.roots) wanted.set(norm(r), r)
    }
    const now = Date.now()
    const todo = [...wanted].filter(([k]) => !(existsCache.get(k)?.at > now - EXISTS_TTL_MS))
    for (let i = 0; i < todo.length; i += 16) {
      await Promise.all(
        todo.slice(i, i + 16).map(async ([k, r]) => existsCache.set(k, { at: now, ok: await exists(r) })),
      )
    }
    return new Set([...wanted.keys()].filter((k) => existsCache.get(k)?.ok === false))
  }

  async function planNow({ auto: isAuto = false, force = true } = {}) {
    const infos = await Promise.all(agents.map(status1))
    const cfg = effectiveConfig()
    const snaps = await snapshots(infos, { force })
    const missing = await missingFolders(snaps, cfg)
    const plan = buildPlan({
      agents: infos.map((i) => ({ id: i.id, name: i.name, capabilities: i.capabilities, status: i.status })),
      snapshots: snaps,
      config: cfg,
      state: state(),
      auto: isAuto,
      missing,
    })
    return { ...plan, infos, snaps }
  }

  function present(plan) {
    const name = (id) => byId.get(id)?.name || id
    return {
      configured: plan.configured,
      items: plan.items.map((i) => ({ ...i, targetName: name(i.target), fromNames: i.from.map(name) })),
      skipped: plan.skipped.map((s) => ({ ...s, targetName: name(s.target) })),
      notes: plan.notes.map((n) => ({ ...n, agentName: name(n.agent) })),
    }
  }

  async function applyNow({ ids = null, auto: isAuto = false } = {}) {
    const plan = await planNow({ auto: isAuto })
    const chosen = ids ? plan.items.filter((i) => ids.includes(i.id)) : plan.items
    const left = ids ? plan.items.filter((i) => !ids.includes(i.id)) : []
    const actions = []
    const byTarget = groupBy(chosen, (i) => i.target)
    for (const [target, list] of byTarget) {
      let results
      try {
        results = await byId.get(target).add(list.map((i) => ({ name: i.name, roots: i.roots })))
      } catch (e) {
        results = list.map(() => ({ ok: false, error: e.message }))
      }
      cache.delete(target)
      list.forEach((it, n) => {
        const r = results[n] || { ok: false, error: "no answer" }
        actions.push({ agent: target, name: it.name, roots: it.roots, ok: !!r.ok, ref: r.ref || "", error: r.error || "", decideKey: it.decideKey })
      })
    }
    const st = state()
    const decided = new Set(st.decided)
    for (const a of actions) if (a.ok) decided.add(a.decideKey)
    for (const i of left) decided.add(i.decideKey) // left out on purpose
    st.decided = [...decided]
    const run = {
      id: crypto.randomUUID(),
      at: new Date().toISOString(),
      auto: isAuto,
      actions: actions.map(({ decideKey, ...a }) => a),
      undone: false,
    }
    if (actions.length) st.history.unshift(run)
    store.saveState()
    const added = actions.filter((a) => a.ok).length
    if (actions.length) log(`${isAuto ? "auto" : "manual"} sync: added ${added}, failed ${actions.length - added}`)
    return { runId: actions.length ? run.id : "", added, failed: actions.length - added, actions: run.actions }
  }

  async function undoNow(runId) {
    const st = state()
    const run = runId ? st.history.find((r) => r.id === runId) : st.history.find((r) => !r.undone)
    if (!run) throw new Error("nothing to undo")
    const reverted = []
    const groups = groupBy(run.actions.filter((a) => a.ok && a.ref && !a.reverted), (a) => a.agent)
    for (const [agent, list] of groups) {
      let results
      try {
        results = await byId.get(agent).remove(list.map((a) => a.ref))
      } catch (e) {
        results = list.map(() => ({ ok: false, error: e.message }))
      }
      cache.delete(agent)
      list.forEach((a, n) => {
        const r = results[n]
        if (r?.ok) a.reverted = true
        reverted.push({ agent, name: a.name, ok: !!r?.ok, error: r?.error || "" })
      })
    }
    run.undone = run.actions.filter((a) => a.ok && a.ref).every((a) => a.reverted)
    store.saveState()
    return { runId: run.id, reverted }
  }

  async function setBaseline() {
    const infos = await Promise.all(agents.map(status1))
    const snaps = await snapshots(infos, { force: true })
    const st = state()
    st.baseline = allFolders(snaps)
    st.baselineAt = new Date().toISOString()
    store.saveState()
  }

  return {
    byId,

    status: () =>
      locked(async () => {
        const infos = await Promise.all(agents.map(status1))
        const snaps = await snapshots(infos)
        const cfg = effectiveConfig()
        return {
          agents: infos.map((i) => ({
            id: i.id,
            name: i.name,
            capabilities: i.capabilities,
            ...i.status,
            count: snaps[i.id]?.ok ? snaps[i.id].workspaces.length : 0,
            error: snaps[i.id]?.ok ? "" : snaps[i.id]?.error || "",
            role: cfg.agents[i.id],
          })),
          auto: { ...config().auto, baselineAt: state().baselineAt, ...auto },
          ignore: config().ignore,
          history: state().history.slice(0, 10),
          dataDir: store.dir,
        }
      }),

    setConfig: (patch) =>
      locked(async () => {
        const cfg = config()
        if (patch.agents) {
          for (const a of agents) {
            const p = patch.agents[a.id]
            if (p) cfg.agents[a.id] = { source: !!p.source && a.capabilities.read, target: !!p.target && a.capabilities.write }
          }
        }
        if (patch.auto) {
          const was = cfg.auto.enabled
          if (typeof patch.auto.enabled === "boolean") cfg.auto.enabled = patch.auto.enabled
          const n = Number(patch.auto.intervalSec)
          if (Number.isFinite(n)) cfg.auto.intervalSec = Math.min(3600, Math.max(5, Math.round(n)))
          if (cfg.auto.enabled && !was) {
            await setBaseline()
            lastFp = ""
          }
        }
        store.saveConfig()
      }),

    ignore: (folder, on) =>
      locked(async () => {
        const cfg = config()
        const k = norm(folder)
        cfg.ignore = (cfg.ignore || []).filter((x) => norm(x) !== k)
        if (on) cfg.ignore.push(folder)
        store.saveConfig()
      }),

    plan: () => locked(async () => present(await planNow())),
    apply: (opts) => locked(() => applyNow(opts)),
    undo: (runId) => locked(() => undoNow(runId)),

    /** One look for the automatic mode: cheap when nothing changed. */
    tick: () =>
      locked(async () => {
        if (!config().auto.enabled) return { skipped: "off" }
        if (!state().baseline) await setBaseline()
        const cfg = effectiveConfig()
        const live = agents.filter((a) => cfg.agents[a.id].source || cfg.agents[a.id].target)
        const fps = await Promise.all(live.map((a) => a.fingerprint().catch(() => "?")))
        const fp = fps.join("~")
        if (fp === lastFp && !retry) return { skipped: "unchanged" }
        lastFp = fp
        auto.checking = true
        try {
          const plan = await planNow({ auto: true, force: false })
          retry = plan.notes.some((n) => cfg.agents[n.agent]?.target)
          if (!plan.items.length) {
            Object.assign(auto, { lastCheck: new Date().toISOString(), error: "" })
            return { added: 0 }
          }
          const res = await applyNow({ auto: true })
          if (res.failed) retry = true
          Object.assign(auto, {
            lastCheck: new Date().toISOString(),
            lastResult: `added ${res.added}${res.failed ? `, ${res.failed} failed` : ""}`,
            error: "",
          })
          return res
        } catch (e) {
          retry = true
          auto.error = e.message
          log(`auto sync: ${e.message}`)
          return { error: e.message }
        } finally {
          auto.checking = false
        }
      }),
  }
}


