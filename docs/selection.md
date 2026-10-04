# 开源终端 MCP 选型

查询时间：2026-10-04。GitHub 活跃情况是本次查询快照，不作为未来维护保证。

| 项目 | 特点 | 本次判断 |
| --- | --- | --- |
| [g0t4/mcp-server-commands](https://github.com/g0t4/mcp-server-commands) | MIT；npm `0.8.2` 压缩约 12 KB；单一运行器支持 argv、stdin、cwd、stdout/stderr、退出码与进程组超时；GitHub 最近推送 2026-09-09 | 选用；直接复用公开发布包的 `build/run_process.js`，无需常驻额外的上游 MCP 子进程 |
| [tinywind/bash-mcp](https://github.com/tinywind/bash-mcp) | MIT；npm `1.1.0` 压缩约 7 KB；命令及后台进程管理；GitHub 最近推送 2025-06-28 | 备选；成功返回缺少明确退出码，整体响应可能被截断成非 JSON，包装需修复更多边界 |
| [1999AZZAR/terminal-mcp-server](https://github.com/1999AZZAR/terminal-mcp-server) | 本地/SSH、会话、文件传输、tmux 与输出压缩 | 功能丰富，当前需求只需节点本地执行与 JSON，因此增加的组件不合适 |
| [wonderwhy-er/DesktopCommanderMCP](https://github.com/wonderwhy-er/DesktopCommanderMCP) | MIT；终端交互、进程控制、文件编辑和搜索 | 适合综合桌面控制；本次已有独立文件系统能力，只包装终端与搜索 |

实现新增：DreamMate HTTP `/health`、`/manifest`、`/invoke`、`/shutdown`，本机报备与
30 秒心跳、stdio MCP、JSON/JSONL 解析、ripgrep 搜索、异步任务查询与取消、部署脚本和 SOP。
保留上游运行器；调用它时统一传 argv，Bash 模式显式调用 `bash --noprofile --norc -c`。

上游会先在内存捕获命令输出。本包装把每次运行放入有 V8 堆限制的 worker，并在 worker 内
截断返回文本；超过资源限制返回 `OUTPUT_RESOURCE_LIMIT` 并清理子进程组。这个机制防止
普通大输出耗尽服务的 JS 堆，不是主机、文件系统、网络或执行命令的内存/CPU 沙箱。

DreamMate 0.8.1 的 HTTP 转发默认等待 15 秒，因此每次调用只等 0–1000 ms，长命令返回
job ID。任务执行期限最多 5 分钟，与单次网络调用期限分开。服务不自动重试执行调用。
