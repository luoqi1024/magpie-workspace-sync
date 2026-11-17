// magpie-workspace-sync: a magpie plugin that keeps the workspace lists of
// the user's AI agents in step.
//
// magpie loads this module into its plugin host (Bun). It
//   * runs the page's service on 127.0.0.1 (the page: ui/, opened from the
//     sidebar's Plugins group),
//   * runs the automatic mode, which needs no page open, and
//   * offers the same sync as tools every agent can call through magpie.
//
// Options (Plugins → this plugin → Options, or `magpie plugin options`):
//   port      the page's service port (default 3481)
//   dataDir   where settings, the journal and backups are kept
//             (default: <magpie config folder>/workspace-sync)

import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { defaultAgents } from "./src/agents/index.js"
import { startAuto } from "./src/auto.js"
import { createServer } from "./src/server.js"
import { createStore } from "./src/store.js"
import { createSync } from "./src/sync.js"
import { createTools } from "./src/tools.js"

const RUNNING = Symbol.for("magpie-workspace-sync.running")
const DEFAULT_PORT = 3481

function magpieDir() {
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "magpie")
}

export const WorkspaceSync = async (input = {}, options = {}) => {
  const log = (msg) => console.log(`[workspace-sync] ${msg}`)
  // a reload in the same process must not leave two loops or hold the port
  await globalThis[RUNNING]?.stop()

  const base = typeof options?.dataDir === "string" && options.dataDir ? options.dataDir : typeof input?.directory === "string" && input.directory ? input.directory : magpieDir()
  const dataDir = options?.dataDir ? base : path.join(base, "workspace-sync")
  const store = createStore(dataDir)
  const sync = createSync({ agents: defaultAgents({ dataDir }), store, log })
  const port = Number(options?.port) > 0 ? Number(options.port) : DEFAULT_PORT

  const server = createServer({ sync, port, uiDir: path.join(path.dirname(fileURLToPath(import.meta.url)), "ui"), log })
  await server.listen()
  const auto = startAuto({ sync, intervalSec: () => store.config().auto.intervalSec, log })
  globalThis[RUNNING] = {
    async stop() {
      auto.stop()
      await server.close()
      globalThis[RUNNING] = undefined
    },
  }
  log(`ready on http://127.0.0.1:${port}/ (data in ${dataDir})`)
  return { tool: createTools(sync) }
}
