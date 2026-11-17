// The Workspace Sync page. Plain DOM, no build step, no inline script (magpie
// shows plugin pages under a strict policy). Everything that comes from another
// app (workspace names, folders) goes in as text, never as HTML.
"use strict"

const T = {
  en: {
    title: "Workspace Sync",
    lead: "Keeps the workspace (project) lists of your AI agents in step. It only ever adds: nothing is edited, renamed or removed.",
    agents: "Agents",
    agent: "Agent",
    count: "Workspaces",
    source: "Template",
    target: "Sync into",
    hint: "A template is an agent whose workspaces are copied. A target is an agent that gets them. Cursor, VS Code and Claude Code can only be templates: they have no project list to add to.",
    mirror: "Mirror all",
    template: "Template",
    useTemplate: "Use as the only template",
    auto: "Automatic sync",
    autoText: "Watches your agents. When you add a workspace in one, it is added to the others at once, even with this page closed. Only workspaces added after you turn this on are synced; a workspace you delete stays deleted.",
    every: "Check every",
    sec: "s",
    min: "min",
    syncNow: "Sync now",
    check: "Check differences",
    checking: "Checking…",
    nothing: "Everything is in step. Nothing to add.",
    setup: "Choose a template and at least one agent to sync into above (or press Mirror all), then check again.",
    syncSel: "Sync selected",
    syncing: "Syncing…",
    ignore: "Never sync",
    unignore: "Allow again",
    skipped: "Left out",
    folderMissing: "folder is missing",
    ignored: "set to never sync",
    history: "History",
    noHistory: "Nothing synced yet.",
    undo: "Undo",
    undone: "undone",
    auto1: "automatic",
    manual1: "manual",
    added: "added",
    failed: "failed",
    on: "Auto on",
    off: "Auto off",
    notInstalled: "Not installed",
    unreadable: "Can't be read",
    readOnly: "history only",
    lastCheck: "Last check",
    lastResult: "Last result",
    since: "Counting from",
    from: "from",
    data: "Data and backups",
    done: "Done",
    reload: "Reload the page: the connection was reset.",
  },
  zh: {
    title: "工作区同步",
    lead: "让各个 AI agent 的工作区（项目）列表保持一致。只会新增：不会修改、重命名或删除任何已有工作区。",
    agents: "Agent",
    agent: "Agent",
    count: "工作区",
    source: "作为范本",
    target: "同步到",
    hint: "范本：把它的工作区复制出去。同步到：接收这些工作区。Cursor、VS Code、Claude Code 只能当范本，它们没有可添加的项目列表。",
    mirror: "互相同步",
    template: "范本",
    useTemplate: "只以它为范本",
    auto: "自动同步",
    autoText: "盯着你的 agent。你在其中一个里新增工作区，其余的立刻跟着新增，不用开着这个页面。只同步开启之后新增的；你删掉的工作区不会被加回来。",
    every: "检查间隔",
    sec: "秒",
    min: "分钟",
    syncNow: "手动同步",
    check: "检查差异",
    checking: "检查中…",
    nothing: "已经一致，没有需要新增的。",
    setup: "请先在上面选好范本和至少一个要同步到的 agent（或点「互相同步」），再检查差异。",
    syncSel: "同步所选",
    syncing: "同步中…",
    ignore: "永不同步",
    unignore: "重新允许",
    skipped: "已跳过",
    folderMissing: "文件夹不存在",
    ignored: "已设为永不同步",
    history: "同步记录",
    noHistory: "还没有同步过。",
    undo: "撤销",
    undone: "已撤销",
    auto1: "自动",
    manual1: "手动",
    added: "新增",
    failed: "失败",
    on: "自动同步已开",
    off: "自动同步已关",
    notInstalled: "未安装",
    unreadable: "读取失败",
    readOnly: "仅历史记录",
    lastCheck: "上次检查",
    lastResult: "上次结果",
    since: "从这时起算",
    from: "来自",
    data: "数据与备份位置",
    done: "完成",
    reload: "请刷新页面：连接已重置。",
  },
}
const L = T[(navigator.language || "en").toLowerCase().startsWith("zh") ? "zh" : "en"]
const token = document.body.dataset.token
const $ = (id) => document.getElementById(id)

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === "class") el.className = v
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v)
    else if (v === true) el.setAttribute(k, "")
    else if (v !== false && v != null) el.setAttribute(k, v)
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)))
  return el
}

async function api(path, body) {
  let res
  try {
    res = await fetch("api/" + path, {
      method: body === undefined ? "GET" : "POST",
      headers: { "x-wsync-token": token, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new Error(L.reload)
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || res.statusText)
  return data
}

function showError(e) {
  const box = $("error")
  box.textContent = e ? e.message || String(e) : ""
  box.hidden = !e
}

let state = null
let plan = null
let picked = new Set()

function ago(iso) {
  if (!iso) return "–"
  return new Date(iso).toLocaleString()
}

/* ---- agents ---- */

function renderAgents() {
  const body = $("agents").tBodies[0]
  body.replaceChildren()
  for (const a of state.agents) {
    const live = a.installed && a.readable
    const tick = (key, can) =>
      h("td", {}, h("input", {
        type: "checkbox",
        checked: !!a.role?.[key],
        disabled: !live || !can,
        title: !can ? L.readOnly : "",
        onchange: (e) => saveRoles({ [a.id]: { ...a.role, [key]: e.target.checked } }),
      }))
    let badge
    if (!a.installed) badge = h("span", { class: "badge" }, L.notInstalled)
    else if (a.error) badge = h("span", { class: "badge warn", title: a.error }, L.unreadable)
    else badge = h("span", { class: "badge ok" }, String(a.count))
    body.append(
      h("tr", { class: live ? "" : "off" },
        h("td", {}, h("div", { class: "name" }, a.name), a.installed && a.reason ? h("div", { class: "sub" }, a.reason) : null),
        h("td", {}, badge),
        tick("source", a.capabilities.read),
        tick("target", a.capabilities.write && a.writable !== false),
      ),
    )
  }
  const pick = $("tmplPick")
  const keep = pick.value
  pick.replaceChildren(...state.agents.filter((a) => a.installed && a.readable).map((a) => h("option", { value: a.id }, a.name)))
  if (keep) pick.value = keep
}

async function saveRoles(patch) {
  try {
    showError(null)
    state = await api("config", { agents: patch })
    renderAll()
    resetPlan()
  } catch (e) {
    showError(e)
  }
}

function allRoles(fn) {
  const out = {}
  for (const a of state.agents) if (a.installed && a.readable) out[a.id] = fn(a)
  return out
}

$("mirror").addEventListener("click", () =>
  saveRoles(allRoles((a) => ({ source: a.capabilities.write, target: a.capabilities.write }))),
)
$("tmplGo").addEventListener("click", () => {
  const id = $("tmplPick").value
  saveRoles(allRoles((a) => ({ source: a.id === id, target: a.id !== id && a.capabilities.write })))
})

/* ---- automatic mode ---- */

function renderAuto() {
  const au = state.auto
  $("chip").textContent = au.enabled ? L.on : L.off
  $("chip").className = "chip" + (au.enabled ? " on" : "")
  $("autoOn").checked = au.enabled
  const every = $("every")
  if (!every.options.length) {
    for (const s of [10, 20, 60, 300]) every.append(h("option", { value: s }, s < 60 ? `${s} ${L.sec}` : `${s / 60} ${L.min}`))
  }
  every.value = String(au.intervalSec)
  if (every.value !== String(au.intervalSec)) every.append(h("option", { value: au.intervalSec, selected: true }, `${au.intervalSec} ${L.sec}`)), (every.value = String(au.intervalSec))
  const bits = []
  if (au.enabled) {
    bits.push(`${L.since}: ${ago(au.baselineAt)}`)
    if (au.lastCheck) bits.push(`${L.lastCheck}: ${ago(au.lastCheck)}`)
    if (au.lastResult) bits.push(`${L.lastResult}: ${au.lastResult}`)
  }
  $("autoStatus").textContent = bits.join(" · ")
  if (au.error) $("autoStatus").textContent += (bits.length ? " · " : "") + au.error
}

$("autoOn").addEventListener("change", async (e) => {
  try {
    showError(null)
    state = await api("config", { auto: { enabled: e.target.checked } })
    renderAuto()
  } catch (err) {
    showError(err)
    e.target.checked = !e.target.checked
  }
})
$("every").addEventListener("change", async (e) => {
  try {
    state = await api("config", { auto: { intervalSec: Number(e.target.value) } })
    renderAuto()
  } catch (err) {
    showError(err)
  }
})

/* ---- manual sync ---- */

function resetPlan() {
  plan = null
  picked = new Set()
  $("plan").replaceChildren()
}

async function checkDiff() {
  const btn = $("check")
  btn.disabled = true
  btn.textContent = L.checking
  try {
    showError(null)
    plan = await api("plan", {})
    picked = new Set(plan.items.map((i) => i.id))
    renderPlan()
  } catch (e) {
    showError(e)
  } finally {
    btn.disabled = false
    btn.textContent = L.check
  }
}
$("check").addEventListener("click", checkDiff)

function renderPlan() {
  const root = $("plan")
  root.replaceChildren()
  for (const n of plan.notes) root.append(h("div", { class: "banner warn" }, `${n.agentName}: ${n.reason}`))
  if (!plan.configured) root.append(h("p", { class: "empty" }, L.setup))
  else if (!plan.items.length) root.append(h("p", { class: "empty" }, L.nothing))
  const groups = new Map()
  for (const i of plan.items) groups.set(i.target, [...(groups.get(i.target) || []), i])
  for (const [, items] of groups) {
    root.append(
      h("div", { class: "group" },
        h("h3", {}, `→ ${items[0].targetName} (${items.length})`),
        items.map((i) =>
          h("div", { class: "row" },
            h("input", {
              type: "checkbox",
              checked: picked.has(i.id),
              onchange: (e) => {
                e.target.checked ? picked.add(i.id) : picked.delete(i.id)
                syncBtn()
              },
            }),
            h("div", { class: "grow" }, h("div", { class: "name" }, i.name), h("div", { class: "path" }, i.roots.join("  ·  "))),
            h("span", { class: "from" }, `${L.from} ${i.fromNames.join(", ")}`),
            h("button", { class: "link", onclick: () => ignore(i.roots[0], true) }, L.ignore),
          ),
        ),
      ),
    )
  }
  if (plan.skipped.length) {
    root.append(
      h("div", { class: "group" },
        h("h3", {}, `${L.skipped} (${plan.skipped.length})`),
        plan.skipped.map((s) =>
          h("div", { class: "row" },
            h("div", { class: "grow" }, h("div", {}, `${s.name} → ${s.targetName}`), h("div", { class: "path" }, s.roots.join("  ·  "))),
            h("span", { class: "from" }, s.reason === "ignored" ? L.ignored : L.folderMissing),
            s.reason === "ignored" ? h("button", { class: "link", onclick: () => ignore(s.roots[0], false) }, L.unignore) : null,
          ),
        ),
      ),
    )
  }
  if (plan.items.length) {
    root.append(h("div", { class: "actions" }, h("span", { id: "pickedN", class: "hint" }), h("button", { id: "syncSel", class: "primary", onclick: applySel }, L.syncSel)))
    syncBtn()
  }
}

function syncBtn() {
  const b = $("syncSel")
  if (!b) return
  b.disabled = picked.size === 0
  b.textContent = `${L.syncSel} (${picked.size})`
}

async function ignore(folder, on) {
  try {
    await api("ignore", { folder, on })
    await checkDiff()
  } catch (e) {
    showError(e)
  }
}

async function applySel() {
  const b = $("syncSel")
  b.disabled = true
  b.textContent = L.syncing
  try {
    showError(null)
    const ids = [...picked]
    const res = await api("apply", { ids })
    state = await api("state")
    renderAll()
    await checkDiff()
    if (res.failed) showError(new Error(res.actions.filter((a) => !a.ok).map((a) => `${a.name}: ${a.error}`).join("\n")))
  } catch (e) {
    showError(e)
    b.disabled = false
  }
}

/* ---- history ---- */

function renderHistory() {
  const ul = $("history")
  ul.replaceChildren()
  if (!state.history.length) ul.append(h("li", { class: "empty" }, L.noHistory))
  const latest = state.history.find((r) => !r.undone)
  for (const r of state.history) {
    const ok = r.actions.filter((a) => a.ok).length
    const bad = r.actions.length - ok
    ul.append(
      h("li", {},
        h("div", { class: "grow" },
          h("div", {}, `${ago(r.at)} · ${r.auto ? L.auto1 : L.manual1} · ${L.added} ${ok}${bad ? ` · ${L.failed} ${bad}` : ""}`),
          h("div", { class: "sub" }, r.actions.slice(0, 4).map((a) => `${a.name}→${state.agents.find((x) => x.id === a.agent)?.name || a.agent}`).join(", ") + (r.actions.length > 4 ? " …" : "")),
        ),
        r.undone ? h("span", { class: "badge" }, L.undone) : r === latest ? h("button", { onclick: () => undo(r.id) }, L.undo) : null,
      ),
    )
  }
}

async function undo(runId) {
  try {
    showError(null)
    await api("undo", { runId })
    state = await api("state")
    renderAll()
    resetPlan()
  } catch (e) {
    showError(e)
  }
}

/* ---- boot ---- */

function renderAll() {
  renderAgents()
  renderAuto()
  renderHistory()
  $("dataDir").textContent = `${L.data}: ${state.dataDir}`
}

function texts() {
  document.documentElement.lang = L === T.zh ? "zh" : "en"
  document.title = L.title
  const set = { title: L.title, lead: L.lead, agentsTitle: L.agents, thAgent: L.agent, thCount: L.count, thSource: L.source, thTarget: L.target, agentsHint: L.hint, mirror: L.mirror, tmplLabel: L.template, tmplGo: L.useTemplate, autoTitle: L.auto, autoText: L.autoText, everyLabel: L.every, syncTitle: L.syncNow, check: L.check, histTitle: L.history }
  for (const [id, t] of Object.entries(set)) $(id).textContent = t
}

async function refresh() {
  try {
    state = await api("state")
    renderAll()
  } catch (e) {
    showError(e)
  }
}

texts()
refresh()
setInterval(() => {
  if (!document.hidden) refresh()
}, 15000)


