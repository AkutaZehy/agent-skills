---
name: zcode-wallet
description: Query ZCode token/quota burn (by project, provider, call type, time; compaction waste; quota pace) via the local zcode-wallet CLI instead of reading db.sqlite or JSONL logs. Use when the user asks about token 消耗/额度/对账/钱包/花了多少/烧了多少/cache 命中.
---

查询 ZCode 本地 token 账本用 zcode-wallet CLI（只读 `~/.zcode/cli/db/db.sqlite`，model_usage JOIN session）。安装一次：`python -m pip install -e <agent-skills 克隆>/zcode-wallet`（可编辑安装，代码更新即生效）；之后统一 `python -m zwallet <command>` 调用：

```bash
python -m zwallet <command>
```

规则：

- 禁止直接读 db.sqlite 或 rollout JSONL——行数多、WAL、烧上下文；一律走本 CLI，输出已足够紧凑。
- 先 `summary` 总览，再按需下钻；解析结果时加 `--json`。

常用配方：

```bash
python -m zwallet summary --quota 600000000   # 总量 + 周额度消化进度
python -m zwallet by --group project          # 按项目
python -m zwallet by --group provider         # 按提供商
python -m zwallet by --group kind             # 按调用类型 main_turn/subagent/compact/session_title
python -m zwallet by --group day --since 7d   # 按时间（week/hour 同理）
python -m zwallet by --group model --since 7d # 复合过滤示例
python -m zwallet sessions --limit 10         # 最近会话
python -m zwallet projects --limit 15         # 按工作区目录聚合（= by --group project 快捷）
python -m zwallet detail <session前缀>        # 单会话逐请求时间线（含压缩断点标记）
python -m zwallet compactions                 # 压缩事件 + 被丢弃上下文估算
python -m zwallet costs --since <周一日期>     # 计费估算：plan=积分加权%（峰谷 aware），pay=金额，free/included=只出量
python -m zwallet price list [模型]           # 价格历史档案（股价式，含来源与峰谷价）
```

价格条目过旧时用 `price add` 追加新查证价（先 websearch 官方定价页）。`by` 的 `--group` 可重复一次做两级分组（如 `--group day --group model`），`--order` 选排序键（时间组默认按时间序），其 `--json` 输出里分组列名为 g1/g2。过滤参数可任意组合：`--provider --model --agent --kind --mode --task --project --session --status --errors-only --since --until`。
