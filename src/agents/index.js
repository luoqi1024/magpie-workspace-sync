// The agents this plugin knows. Adding one is one adapter file and one line
// here. An adapter is:
//
//   id, name
//   capabilities   { read, write, multiRoot }
//   detect()       -> { installed, readable, writable, reason }   cheap
//   fingerprint()  -> string that changes when the list may have changed (cheap)
//   list()         -> [{ name, roots: [folder], ref? }]
//   add(items)     -> [{ ok, ref?, error? }]    items: [{ name, roots }]
//   remove(refs)   -> [{ ok, error? }]          undoes an add (write agents only)

import path from "node:path"
import { antigravityAgent } from "./antigravity.js"
import { codexAgent } from "./codex.js"
import { dshAgent } from "./dsh.js"
import { claudeAgent, vscodeFamilyAgent } from "./history.js"

/** @param {{ dataDir?: string, homes?: Record<string,string> }} opts */
export function defaultAgents({ dataDir = "", homes = {} } = {}) {
  return [
    codexAgent({ home: homes.codex }),
    antigravityAgent({ home: homes.antigravity }),
    dshAgent({ home: homes.dsh, backupDir: dataDir ? path.join(dataDir, "backups", "dsh") : "" }),
    vscodeFamilyAgent({ id: "cursor", name: "Cursor", dirName: "Cursor", home: homes.cursor }),
    vscodeFamilyAgent({ id: "vscode", name: "VS Code", dirName: "Code", home: homes.vscode }),
    claudeAgent({ file: homes.claude }),
  ]
}
