# shell-hygiene

给编码 agent（ZCode / Claude Code 等 SKILL.md 类 harness）的 Windows / Git Bash 命令操作手册。核心主张一句话：**在 Windows 上跑命令，路径形态、引号、编码、退出码、回滚五件事先定下来，命令再执行。**

## 用途

本机（Windows + Git Bash）上跑 Bash / PowerShell / Python / Node 命令时的操作纪律，覆盖：MSYS 路径转换与三种路径形态、空格与中文与撇号的引号处理、heredoc 与 `-c` 转义、Python 与 PowerShell 5.1 / pwsh 7 的输出编码、预期非零退出码与真错的区分、破坏性操作前的备份与回滚，以及一条命令一次做完时的六项预检；第 11 节另给输出落盘与批量纪律（ctx-batch、日志落盘）。

SKILL.md 里的每条规则都带本机实测值（bash 5.3.15 cygwin、ugrep 7.8.4 包装的 grep、Python 3.12.9、PowerShell 5.1.26100.9711 与 pwsh 7.6.7、Node v26.7.0、gh 已登录、cmd 代码页 936），每条给正例与反例。

## 安装

```bash
# 脚本方式（默认 SKILLS 列表含 shell-hygiene）
./install.sh --zcode
./install.sh --dsh
./install.sh --claude

# 手动方式
cp skills/shell-hygiene/SKILL.md ~/.zcode/skills/shell-hygiene/SKILL.md
```

本 skill 是工具型 skill：事件驱动，description 触发词就是启动条件，无需 AGENTS.md 引用块。

## 触发词

- 中文：Windows 命令、Git Bash、bash 报错、路径格式、引号、编码、BOM、乱码、退出码、oneshot、预检
- 场景：命令在 Windows 上报错、路径看起来不对、输出出现乱码或 BOM、要写一条一次做完的命令、准备删除或覆盖文件之前

## 与其他 skill 的关系

| Skill | 分工 |
|---|---|
| [ask-first](../ask-first/) | 开工前反问、变更与外发门禁；本 skill 不管要不要做，只管命令怎么写才不炸 |
| [memory-hygiene](../memory-hygiene/) | 写记忆文件的内容纪律；本 skill 覆盖文件与命令的操作层 |
| [test-hygiene](../test-hygiene/) | 测试内容与断言质量；本 skill 管跑测试那条命令本身 |
| [publish-privacy-alert](../publish-privacy-alert/) | 发布前的隐私扫描；本 skill 覆盖扫描命令本身的路径与编码 |

这些 skill 可叠加：ask-first 判定「这条命令属于变更类操作」，shell-hygiene 判定「这条命令的路径、引号、编码、退出码与回滚是否成立」。
