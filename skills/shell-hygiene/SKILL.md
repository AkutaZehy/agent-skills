---
name: shell-hygiene
description: Run shell commands on this Windows box without the usual Git Bash traps - MSYS path conversion, three path forms, quoting for spaces/Chinese/apostrophes, heredoc and -c escaping for Python/Node, UTF-8 IO in PowerShell 5.1 and pwsh 7, expected non-zero exit codes, and rollback for destructive steps. Use when a Bash command fails on Windows, when a path or quote looks wrong, when output shows mojibake or a BOM, or when preparing a one-shot command that must leave the tree intact. 触发词：Windows 命令、Git Bash、bash 报错、路径格式、引号、编码、BOM、乱码、退出码、oneshot、预检。
---

# Shell Hygiene

在 Windows 上跑命令时，路径形态、引号、编码、退出码、回滚这五件事先定下来，命令再执行。下面每条规则都给正例与反例，事实来自本机实测（2026-10-26）。

## 1. 本机环境事实

| 组件 | 实测值 | 对命令的影响 |
|---|---|---|
| Git Bash | GNU bash 5.3.15(1)-release (x86_64-pc-cygwin)，`uname -a` 显示 MINGW64_NT-10.0-26300 | bash 内建与 MSYS 程序用 POSIX 路径 |
| grep | shell function 包 ugrep 7.8.4 WIN64（`-G --ignore-files --hidden -I --exclude-dir=.git …`） | 默认跳过 .gitignore 里的文件与二进制；参数属于 `--filter/--pager/-Z/--null` 一类时回落 `command grep` |
| Python | 3.12.9 | 环境里已有 `PYTHONIOENCODING=utf-8` 与 `PYTHONUTF8=1`，stdout 默认 utf-8；这两个变量缺席时回落 `gbk`（utf8_mode=0） |
| PowerShell | 5.1.26100.9711（`powershell`）、7.6.7（`pwsh`） | 两者都在 PATH 上，写文件的默认编码不同（第 5 节） |
| Node | v26.7.0 | stdout 默认 UTF-8 |
| gh | 已登录 GitHub CLI（keyring，ssh 协议；账号与 scopes 用 `gh auth status` 查） | `gh api`、`gh repo view` 可直接跑，无需再登录 |
| 控制台代码页 | cmd 活动代码页 936（GBK） | `chcp` 不在 Git Bash 里（command not found），只能用 `cmd //c chcp 65001` |
| 路径工具 | cygpath 在 `/usr/bin/cygpath` | `cygpath -m /c/x` → `C:/x`；`cygpath -w /c/x` → `C:\x` |

三条推论：`grep` 是 ugrep 的包装而不是 GNU grep（默认遵守 .gitignore）；`powershell` 与 `pwsh` 是两个不同编码约定的解释器；MSYS 会改写传给 Windows 程序的参数（第 6 节）。

## 2. 路径三形态

| 形态 | 例子 | 用在哪 |
|---|---|---|
| MSYS 路径 | `/c/Users/<user>` | bash 内建与 MSYS 程序（ls、cat、grep、mktemp） |
| Windows 正斜杠 | `C:/Users/<user>` | node、python、pwsh 等原生程序；`cygpath -m` 的输出 |
| Windows 反斜杠 | `C:\Users\<user>` | cmd、PowerShell 字符串；`cygpath -w` 的输出 |

选用规则：bash 里操作文件写 `/c/...`；交给 Windows 程序前先 `cygpath -m` 转成 `C:/...`；配置文件与脚本里的绝对路径写 `C:/...`（正斜杠不需要转义）；传给 cmd.exe 的用 `C:\...` 并加引号。

反例：`ls C:\Users\<user>` —— bash 把 `\U` 当转义符，得到错误路径。正例：`ls /c/Users/<user>`（bash 内）或 `ls 'C:\Users\<user>'`（整串加引号）。

## 3. 引号、空格、中文、撇号

- 路径含空格时整串加双引号：`cat "C:/Program Files/app/config.json"`。反例 `cat C:/Program Files/app/config.json` 会被拆成两个参数。
- 撇号在单引号串里用双引号包（`grep "it's" file`）或 `'\''` 转义（`grep 'it'\''s' file`），两种实测都可用；反例 `grep 'it's' file` 的引号提前闭合。
- 中文路径在 Git Bash 下正常（实测 `ls`/`cat` 可读 `dir with space/文件 名.txt`）；交给 Windows 程序前 `cygpath -m` 转路径。
- 双引号里 `$`、`` ` ``、`\` 仍会被 shell 解释，含这些字符的字面量用单引号包；需要变量展开时再用双引号：`"$dir/$file"`。

## 4. heredoc 与 -c 转义（Python / Node）

- 外层单引号 + 内层双引号是默认姿势：`python -c 'print(r"C:\temp")'` → 输出 `C:\temp`。
- 反例：`python -c "print('C:\temp')"` → 输出 `C:<TAB>emp`（`\t` 变成制表符）。shell 的双引号不保护反斜杠，Python 层照常解释转义序列。
- 多行脚本走 heredoc，分隔符加引号阻止变量展开：

```bash
python - <<'PY'
import pathlib
print([p.name for p in sorted(pathlib.Path(".").glob("*.md"))])
PY
```

- 反例：`python - <<PY`（分隔符不加引号）会展开 `$VAR` 与反引号，脚本里的字面量被改写。
- Node 同理：`node -e 'console.log(`x`)'` 里反引号是字面量（单引号内不触发命令替换，输出 `x`）；双引号包裹时 bash 先做命令替换（实测报 `x: command not found`）。

## 5. 编码三件套

**(a) Python 输出端** — 环境里 `PYTHONIOENCODING=utf-8` 与 `PYTHONUTF8=1` 已生效（实测 stdout 为 utf-8）；变量缺席时 stdout 回落 `gbk`。处方：脚本自己写文件时显式 `open(..., encoding="utf-8")`；向 stdout 写中文时在命令前补 `PYTHONIOENCODING=utf-8`，在被清空的环境或别的启动器下这是必需的。

**(b) PowerShell 5.1** — `$OutputEncoding` 是 us-ascii（管道传给原生命令时按 ASCII 编码，中文参数会掉字符）；`[Console]::OutputEncoding` 是 gb2312（控制台代码页 936）。写文件的默认编码实测：`>` 与 `Out-File` → UTF-16LE 带 BOM（`FF FE`）；`Out-File -Encoding utf8` → UTF-8 带 BOM（`EF BB BF`）；`Set-Content` → ANSI 无 BOM。处方：需要无 BOM 的 UTF-8 时用 `[System.IO.File]::WriteAllText($p, $s, [System.Text.UTF8Encoding]::new($false))`（实测写出 6 字节纯 UTF-8）；纯 ASCII 内容用 `Set-Content -Encoding ascii`；读 UTF-8 文件显式 `Get-Content -Encoding utf8` —— 默认按 ANSI 读，中文变乱码（实测 `中文测试` 变成乱码字节）。

**(c) chcp 不可靠** — `chcp` 是 cmd 内建命令，Git Bash 里直接 command not found；`cmd //c chcp 65001` 只改 cmd 自己的控制台，对已在运行的 PowerShell / Python 进程无效。编码问题用环境变量与显式参数解决，代码页只影响交互式显示。

## 6. MSYS 路径转换与 MSYS_NO_PATHCONV=1

- MSYS 把非 MSYS 程序（python、node、pwsh、cmd）参数里的 POSIX 路径改写成 Windows 路径。实测：`python -c "import sys;print(sys.argv)" /c/Users/<user>` → `['-c', 'C:/Users/<user>']`。
- 需要程序收到原样的 POSIX 路径时用 `MSYS_NO_PATHCONV=1 <cmd>`，实测同一命令得到 `['-c', '/c/Users/<user>']`。
- 该变量对所有参数生效，所以 `cmd /c ver` 里的 `/c` 也不会被改写 —— cmd 能跑起来的两种写法：`cmd //c ver`（实测正常输出版本号）或 `MSYS_NO_PATHCONV=1 cmd /c ver`。
- 反例：`cmd /c ver` —— `/c` 被改写成 `C:/`，cmd 拿不到子命令，只打印启动 banner。

## 7. PowerShell / cmd 调用姿势

- 脚本文件：`pwsh -NoProfile -File script.ps1`。有 pwsh 就优先用它：默认写 utf8NoBOM，`$OutputEncoding` 是 utf-8。
- 单行命令：`powershell -NoProfile -Command 'Write-Output "x"'` —— 外层单引号、内层双引号，实测输出 `x`。
- `-NoProfile` 必带：用户 profile 里的别名与函数会改写命令语义。
- 引号超过三层就落成 `.ps1` 文件再 `-File`，省掉转义层。`pwsh -NoProfile -File -` 读 stdin 会带交互提示行（实测输出里混进 `PS C:\...>` 回显），不适合当管道用。
- cmd：`cmd //c <command>`。

## 8. 失败语义：预期非零 vs 真错

- 常见的「预期非零」：`grep` 无匹配返回 1、`git diff --quiet` 有差异返回 1、`test` / `[` 为假返回 1。
- 真错的量级：命令不存在 127、路径或权限错 2、段错误 139。
- 白名单式收口（推荐）：

```bash
grep -q NEEDLE "$f" || { rc=$?; [ "$rc" -eq 1 ] || exit "$rc"; }
```

- 实测：`grep -q zzz f` 的 1 被吸收为 0；`sh -c 'exit 2'` 的 2 原样冒泡为失败。
- `|| true` 只在上一条命令的退出码已被显式检查过时才有意义，否则它把真错吞成成功、让脚本带着坏状态继续跑。默认用 `set -euo pipefail`，要放过某一条就写 `|| [ $? -eq 1 ]` 这种白名单。
- `$?` 必须在下一条命令之前取，任何命令都会覆盖它。

## 9. 破坏性操作纪律与回滚

- rm、mv、覆盖之前先看目标：`ls -la "$target"`、`git status --porcelain`。非 git 目录先 `cp -a "$target" "$d/"` 备份，备份目录用 `mktemp -d`（实测形如 `/tmp/tmp.XXXXXXXXXX`）。
- 临时目录配 trap：`d=$(mktemp -d); trap 'rm -rf "$d"' EXIT` —— 正常结束与中断都清掉。
- git 仓库里改文件前留快照：`git status --porcelain > /tmp/before.txt`，改完 `git diff` 对照；未追踪文件另存副本，git status 覆盖不到它们的内容。
- 删除走 porcelain 范围（`git rm -r -- path`），不用通配符 rm。
- 一次只动一个目标目录；先在副本上演练，再动原件。

## 10. 反例库与 oneshot 预检

| 反例 | 现象 | 正例 |
|---|---|---|
| `ls C:\Users\<user>` | bash 转义 `\U`，路径错 | `ls /c/Users/<user>` |
| `cmd /c ver` | `/c` 被改写成 `C:/`，只打印 banner | `cmd //c ver` |
| `cat C:/Program Files/app/x.json` | 拆成两个参数 | `cat "C:/Program Files/app/x.json"` |
| `grep 'it's' f` | 引号提前闭合 | `grep "it's" f` |
| `python -c "print('C:\temp')"` | 输出 `C:<TAB>emp` | `python -c 'print(r"C:\temp")'` |
| `python - <<PY` | `$VAR` 与反引号被展开 | `python - <<'PY'` |
| `powershell -Command "... > x.txt"` | x.txt 是 UTF-16LE BOM | `pwsh -NoProfile -File w.ps1`（utf8NoBOM）或显式指定编码 |
| `Get-Content x.txt`（5.1） | UTF-8 中文按 ANSI 读成乱码 | `Get-Content -Encoding utf8 x.txt` |
| `grep -rn "needle" .` | 命中不到 .gitignore 里的文件 | `grep -rn --no-ignore-files "needle" .` |
| `set -e; grep -q x f \|\| true` | 真错被吞成成功 | `\|\| { rc=$?; [ "$rc" -eq 1 ] \|\| exit "$rc"; }` |

oneshot 预检 6 项 —— 一条命令要一次做完时，先过这六关：

1. **目标存在** —— 路径与文件确实在（`test -e` / `ls`），确认没把目标写到别的目录。
2. **引号** —— 路径含空格、中文或撇号时已加引号。
3. **编码** —— 输出端与文件端编码已定：Python 用 utf-8，pwsh 用 utf8NoBOM，PS 5.1 用 ascii 或显式 UTF8Encoding。
4. **工具可用** —— `command -v python node pwsh gh cygpath` 全部命中。
5. **预期退出码** —— 哪些非零是预期的（grep 1、diff 1）已写明，并用白名单收口。
6. **回滚** —— 改动可恢复：git 追踪文件、备份副本、或 trap 清掉的临时目录。

## 11. 输出落盘与批量纪律

- 工作目录跨调用保持：一律用绝对路径，不写 `cd`（也避开 `cd x && ...` 触发的权限确认）。
- 小范围探索（<5 个文件、<3 个目录）用一个 Python/Node 脚本跑完、只打印摘要；完整输出重定向到 `.ctx/logs/`，需要时再分页读。触达更宽时按 AGENTS.md 团队协作节的派发阈值走 Explore。
- 大输出先落盘再 grep/head/tail，整段日志不直接放进上下文。
- 批量任务优先 ctx-batch skill（脚本 `~/.zcode/bin/ctx.py`）：一次扫描/读取/执行只回摘要，全文落 `.ctx/logs/`。
