# magpie-workspace-sync

[magpie](https://github.com/yetone/magpie) 插件：让你电脑上各个 AI agent 的**工作区（项目）列表保持一致**。在 Codex 里新建一个项目，Antigravity 和 DeepSeek Harness 里也会出现，一键同步，或者自动同步。

[English](README.md)

你来选：哪些 agent 参与、谁的工作区做**范本**、同步**到**哪些 agent。同步**只新增**，不会修改、重命名或删除任何已有工作区。

## 安装

```sh
magpie plugin add github:luoqi1024/magpie-workspace-sync
```

也可以在 magpie 里：**插件 → 添加插件**，填上面的地址（或本地文件夹）。装好后在侧边栏「插件」分组里打开 **工作区同步**。

## 支持的 agent

| Agent | 读 | 写 | 写入方式 |
| --- | :-: | :-: | --- |
| Codex | 是 | 是 | 走 Codex 自己的 app-server（`project/create`），不碰它的数据库 |
| Antigravity | 是 | 是 | 走它的语言服务（`CreateProject`），需要 Antigravity 正在运行 |
| DeepSeek Harness | 是 | 是 | 改 `workspace.json`，先备份、原子写入 |
| Cursor、VS Code | 是 | – | 读「最近打开」的文件夹，只能当范本 |
| Claude Code | 是 | – | 读 `~/.claude.json` 里的文件夹，只能当范本 |

有项目列表的 agent 可以当范本也可以当目标；只记得「最近打开」的编辑器只能当范本。加一个新 agent 只要写一个适配器文件（`src/agents/`）。

## 怎么用

1. **选 agent。** 每个 agent 勾「作为范本」和/或「同步到」。「互相同步」让所有 agent 都是范本和目标；也可以选一个 agent 点「只以它为范本」。没选之前什么都不会同步，所以第一次运行绝不会往任何地方写东西。
2. **手动同步。** 点「检查差异」，列出会往哪个 agent 新增什么。不想要的取消勾选，或对某个文件夹点「永不同步」；点「同步所选」才真正新增。
3. **撤销。** 同步记录里每次都有「撤销」，只会移除那一次新增的内容。
4. **自动同步**（可选）。打开后它会盯着各个 agent：你在其中一个里新增工作区，几秒内其余的就跟着新增，不需要开着页面。

### 规则

- 一个工作区由它的**文件夹**决定。不同 agent 对同一个文件夹的写法不一样（`D:\Dev\x`、`d:/dev/x/`、`file:///d%3A/dev/x`）也算同一个。
- 目标里已有某项目的第一个文件夹，就算「已经有了」。能装多个文件夹的目标（Codex、Antigravity）整项目照搬；只能装一个文件夹的（DeepSeek Harness）则缺哪个文件夹就新增哪个。
- 已经不存在的文件夹会跳过。
- **自动同步只处理开启之后新增的。** 开启前已有的留给手动同步，所以打开它不会把你的历史全部复制一遍。你在目标里删掉的工作区**不会**被加回来。
- 目标暂时不可用（比如 Antigravity 没开）会一直重试，直到可用。

## 给 agent 用的工具

同一套同步也通过 magpie 的 MCP 服务（`/mcp/magpie/tools`）提供给所有 agent：`magpie-workspace-sync_status`、`_plan`、`_run`、`_undo`。`run` 不带 `confirm: true` 只预览；页面里没选好范本和目标之前什么都不做。

## 选项

插件 → 本插件 → 选项（或 `magpie plugin options magpie-workspace-sync '{"port":3490}'`）：

| 选项 | 默认值 | 说明 |
| --- | --- | --- |
| `port` | `3481` | 页面服务的端口，只监听 127.0.0.1 |
| `dataDir` | `<magpie 配置目录>/workspace-sync` | 设置、同步记录和备份的位置 |

环境变量 `CODEX_HOME`、`CODEX_BIN`、`DSH_HOME` 同样有效。

## 安全

- 只新增；有官方入口的（Codex、Antigravity）都走它们自己的入口。DeepSeek Harness 没有入口，所以先把文件复制一份备份（`dataDir/backups/dsh` 里保留最近 10 份），改动写到临时文件再重命名，遇到不认识的版本（`unit.version` ≠ 2）绝不动手。
- 页面服务只监听 127.0.0.1 并检查 `Host`；每个 API 调用都要带令牌，令牌只在页面自己的 HTML 里，而且这份 HTML 不会交给脚本的 `fetch`，所以别的网站读不到。
- 插件以你的权限运行在 magpie 的宿主里。本插件只读各 agent 的项目列表，只做上面说的新增，不联网发送任何数据。

## 不装 magpie 也能用

```sh
node scripts/cli.mjs status
node scripts/cli.mjs plan --from codex --to dsh,antigravity
node scripts/cli.mjs apply --yes --from codex --to dsh,antigravity
node scripts/cli.mjs undo
```

## 开发

```sh
npm test      # Node 22+，无依赖
```

Codex 的测试会用真实的 Codex app-server 配一个临时 `CODEX_HOME`，没装 Codex 就跳过。

## 许可

MIT
