#!/usr/bin/env python3
"""zcode-wallet — read-only analytics over ZCode's local token ledger.

Data source: ~/.zcode/cli/db/db.sqlite (model_usage / session tables).
Every model request ZCode makes is already persisted there by the app itself,
so this tool is a pure reader: no hooks, no daemons, no double bookkeeping.

Stdlib only. Python >= 3.8.
"""

import argparse
import json
import os
import re
import shutil
import sqlite3
import sys
import tempfile
import time
from datetime import datetime

DEFAULT_DB = os.path.join(os.path.expanduser("~"), ".zcode", "cli", "db", "db.sqlite")

KIND_LABEL = {
    "main_turn": "main",
    "subagent": "subagent",
    "compact": "compact",
    "session_title": "title",
}

GROUPS = {
    "provider": "m.provider_id",
    "model": "m.model_id",
    "variant": "m.variant",
    "agent": "m.agent",
    "mode": "m.mode",
    "kind": "m.query_source",
    "task": "m.task_type",
    "status": "m.status",
    "project": "coalesce(s.directory, '(unknown)')",
    "session": "m.session_id",
    "day": "date(CAST(m.started_at AS INTEGER)/1000, 'unixepoch', 'localtime')",
    "week": "date(CAST(m.started_at AS INTEGER)/1000, 'unixepoch', 'localtime', 'weekday 1', '-6 days')",
    "hour": "strftime('%Y-%m-%d %H:00', CAST(m.started_at AS INTEGER)/1000, 'unixepoch', 'localtime')",
}

AGG_SQL = """
    COUNT(*)                                     AS requests,
    SUM(COALESCE(NULLIF(CAST(m.computed_total_tokens AS INTEGER), 0),
        COALESCE(CAST(m.input_tokens AS INTEGER), 0)
      + COALESCE(CAST(m.output_tokens AS INTEGER), 0)))          AS total,
    SUM(MAX(CAST(m.input_tokens AS INTEGER)
        - COALESCE(CAST(m.cache_read_input_tokens AS INTEGER), 0)
        - COALESCE(CAST(m.cache_creation_input_tokens AS INTEGER), 0), 0)) AS fresh_in,
    SUM(COALESCE(CAST(m.cache_read_input_tokens AS INTEGER), 0))  AS cache_read,
    SUM(COALESCE(CAST(m.cache_creation_input_tokens AS INTEGER), 0)) AS cache_write,
    SUM(COALESCE(CAST(m.output_tokens AS INTEGER), 0))            AS output,
    SUM(COALESCE(CAST(m.reasoning_tokens AS INTEGER), 0))         AS reasoning,
    SUM(m.status = 'error')                                       AS errors,
    ROUND(SUM(COALESCE(CAST(m.output_tokens AS INTEGER), 0)) * 1.0
      / NULLIF(SUM(CASE WHEN CAST(m.first_token_at AS INTEGER) > 0
        THEN (CAST(m.completed_at AS INTEGER) - CAST(m.first_token_at AS INTEGER)) / 1000.0
        ELSE 0 END), 0), 1)                                       AS tok_s
"""

FROM_SQL = "FROM model_usage m LEFT JOIN session s ON s.id = m.session_id"


# ---------------------------------------------------------------- utilities

def open_db(path):
    """Open read-only; on lock/corruption fall back to a temp copy."""
    try:
        con = sqlite3.connect("file:%s?mode=ro" % path.replace("\\", "/"), uri=True)
        con.execute("SELECT COUNT(*) FROM model_usage").fetchone()
        return con, path
    except sqlite3.Error:
        tmp = tempfile.mkdtemp(prefix="zwallet-")
        cpath = os.path.join(tmp, "db.sqlite")
        for ext in ("", "-wal", "-shm"):
            if os.path.exists(path + ext):
                shutil.copy2(path + ext, cpath + ext)
        con = sqlite3.connect(cpath)
        return con, cpath + " (copied: original locked)"


def parse_time(s):
    """'7d' / '24h' / '2w' / '2026-09-01' / '2026-09-01 10:30' -> epoch ms."""
    s = s.strip()
    m = re.fullmatch(r"(\d+)\s*([dhwy])", s, re.I)
    if m:
        n, u = int(m.group(1)), m.group(2).lower()
        return int(time.time() * 1000) - n * {"h": 3600, "d": 86400, "w": 604800, "y": 31536000}[u] * 1000
    for fmt in ("%Y-%m-%d %H:%M", "%Y-%m-%d"):
        try:
            return int(time.mktime(time.strptime(s, fmt)) * 1000)
        except ValueError:
            pass
    raise SystemExit("zcode-wallet: cannot parse time %r (use 7d / 2026-09-01)" % s)


def apply_filters(args):
    where, params = [], []
    def like(col, val):
        where.append("%s LIKE ?" % col)
        params.append("%" + val + "%")
    if args.provider:  like("m.provider_id", args.provider)
    if args.model:     like("m.model_id", args.model)
    if args.agent:     like("m.agent", args.agent)
    if args.kind:      like("m.query_source", args.kind)
    if args.mode:      like("m.mode", args.mode)
    if args.task:      like("m.task_type", args.task)
    if args.project:   like("s.directory", args.project)
    if args.session:   like("m.session_id", args.session)
    if args.status:    where.append("m.status = ?"); params.append(args.status)
    if args.errors_only: where.append("m.status = 'error'")
    if getattr(args, "since", None):
        where.append("CAST(m.started_at AS INTEGER) >= ?"); params.append(parse_time(args.since))
    if getattr(args, "until", None):
        where.append("CAST(m.started_at AS INTEGER) < ?"); params.append(parse_time(args.until))
    return ("WHERE " + " AND ".join(where)) if where else "", params


def fmt_tokens(n):
    n = n or 0
    a = abs(n)
    if a >= 1e9: return "%.2fG" % (n / 1e9)
    if a >= 1e6: return "%.2fM" % (n / 1e6)
    if a >= 1e4: return "%.1fk" % (n / 1e3)
    return str(int(n))


def fmt_speed(v):
    return ("%s tok/s" % fmt_tokens(int(v))) if v else "-"


def print_table(headers, rows, json_mode, json_rows=None):
    if json_mode:
        print(json.dumps(json_rows if json_rows is not None else rows, ensure_ascii=False, indent=2, default=str))
        return
    widths = [len(h) for h in headers]
    cells = [[("" if c is None else str(c)) for c in r] for r in rows]
    for r in cells:
        for i, c in enumerate(r):
            widths[i] = max(widths[i], len(c))
    def line(parts):
        return "  ".join(parts[i].ljust(widths[i]) if i < len(parts) - 1 else parts[i] for i in range(len(parts)))
    print(line(headers))
    for r in cells:
        print(line(r))


def short_dir(d):
    if not d: return "(unknown)"
    d = d.replace("\\", "/").rstrip("/")
    return d.rsplit("/", 1)[-1] or d


def short_sess(sid):
    return (sid or "")[-8:] if sid else ""


# ---------------------------------------------------------------- commands

def build_summary(con, args):
    where, params = apply_filters(args)
    agg = AGG_SQL[AGG_SQL.index("COUNT(*)"):]
    cur = con.execute("SELECT %s, MIN(CAST(m.started_at AS INTEGER)) AS t0, MAX(CAST(m.started_at AS INTEGER)) AS t1, COUNT(DISTINCT m.session_id) AS sessions %s %s" % (agg, FROM_SQL, where), params)
    names = [d[0] for d in cur.description]
    row = dict(zip(names, cur.fetchone()))
    extra = con.execute(
        "SELECT SUM(m.query_source='compact'), SUM(m.cancelled_by_user=1), "
        "SUM(m.status='error' AND (m.error_message LIKE '%quota%' OR m.error_code LIKE '%429%' OR m.error_type LIKE '%rate%')) "
        + FROM_SQL + " " + where, params).fetchone()
    row["compactions"] = extra[0] or 0
    row["cancelled"] = extra[1] or 0
    row["rate_limited"] = extra[2] or 0
    return row


def render_summary(con, args):
    row = build_summary(con, args)
    if args.json:
        print(json.dumps(row, ensure_ascii=False, indent=2, default=str))
        return
    t0 = datetime.fromtimestamp((row["t0"] or 0) / 1000).strftime("%Y-%m-%d")
    t1 = datetime.fromtimestamp((row["t1"] or 0) / 1000).strftime("%Y-%m-%d %H:%M")
    tin = (row["fresh_in"] or 0) + (row["cache_read"] or 0) + (row["cache_write"] or 0)
    print("ZCode token wallet  |  %s .. %s  (%s)" % (t0, t1, args.db_note))
    print("requests %s  sessions %s  errors %s (rate-limited %s, cancelled %s)" % (
        row["requests"], row["sessions"], row["errors"], row["rate_limited"], row["cancelled"]))
    print("total      %s" % fmt_tokens(row["total"]))
    print("  input    %s  (fresh %s | cache read %s | cache write %s)" % (
        fmt_tokens(tin), fmt_tokens(row["fresh_in"]), fmt_tokens(row["cache_read"]), fmt_tokens(row["cache_write"])))
    print("  output   %s  (reasoning %s inside)" % (fmt_tokens(row["output"]), fmt_tokens(row["reasoning"])))
    if tin:
        print("  cache hit rate  %.1f%% of input served from cache" % (100.0 * (row["cache_read"] or 0) / tin))
    if row["tok_s"]:
        print("  avg gen speed   %s tok/s" % fmt_tokens(int(row["tok_s"])))
    if row["compactions"]:
        print("  compaction events recorded by ZCode: %s (see `compactions`)" % row["compactions"])
    if getattr(args, "quota", None):
        week_where, week_params = apply_filters(argparse.Namespace(**{**vars(args), "since": "7d", "until": None}))
        cur = con.execute("SELECT %s %s %s" % (AGG_SQL[AGG_SQL.index("COUNT(*)"):], FROM_SQL, week_where), week_params)
        w = dict(zip([d[0] for d in cur.description], cur.fetchone()))
        pct = 100.0 * (w["total"] or 0) / args.quota
        print("last 7d     %s  of quota %s  ->  %.1f%% used" % (fmt_tokens(w["total"]), fmt_tokens(args.quota), pct))
        print("  daily avg %s   projected/week %s" % (
            fmt_tokens((w["total"] or 0) / 7.0), fmt_tokens((w["total"] or 0))))


def cmd_by(con, args):
    where, params = apply_filters(args)
    exprs = [GROUPS[g] for g in args.group]
    labels = list(args.group)
    sel = ", ".join("%s AS g%d" % (e, i + 1) for i, e in enumerate(exprs))
    order = {"total": "total", "requests": "requests", "output": "output",
             "fresh_in": "fresh_in", "cache_read": "cache_read"}.get(args.order, "total")
    if args.order is None and any(g in ("day", "week", "hour") for g in args.group):
        order = "g1"  # time groups read naturally in chronological order
    sql = "SELECT %s, %s %s %s GROUP BY %s ORDER BY %s DESC LIMIT %d" % (
        sel, AGG_SQL, FROM_SQL, where, ", ".join("g%d" % (i + 1) for i in range(len(exprs))), order, args.limit)
    cur = con.execute(sql, params)
    names = [d[0] for d in cur.description]
    recs = [dict(zip(names, r)) for r in cur.fetchall()]
    if args.json:
        print(json.dumps(recs, ensure_ascii=False, indent=2, default=str))
        return
    headers = labels + ["reqs", "total", "fresh_in", "cache_read", "cache_write", "output", "reasoning", "errs", "hit%", "tok/s"]
    rows = []
    for r in recs:
        gvals = [short_dir(r["g1"]) if labels[0] == "project" else (short_sess(r["g1"]) if labels[0] == "session" else r["g1"])]
        if len(labels) > 1:
            gvals.append(r["g2"] or "")
        tin = (r["fresh_in"] or 0) + (r["cache_read"] or 0) + (r["cache_write"] or 0)
        rows.append(gvals + [r["requests"], fmt_tokens(r["total"]), fmt_tokens(r["fresh_in"]),
                             fmt_tokens(r["cache_read"]), fmt_tokens(r["cache_write"]),
                             fmt_tokens(r["output"]), fmt_tokens(r["reasoning"]), r["errors"] or 0,
                             "%.0f%%" % (100.0 * (r["cache_read"] or 0) / tin) if tin else "-",
                             fmt_speed(r["tok_s"])])
    print_table(headers, rows, False)


def cmd_sessions(con, args):
    where, params = apply_filters(args)
    sql = ("SELECT m.session_id, MAX(s.title), MAX(s.directory), COUNT(*) reqs, %s, "
           "datetime(MAX(CAST(m.started_at AS INTEGER))/1000, 'unixepoch', 'localtime') AS last "
           "%s %s GROUP BY m.session_id ORDER BY last DESC LIMIT %d") % (
        AGG_SQL[AGG_SQL.index("COUNT(*)"):], FROM_SQL, where, args.limit)
    cur = con.execute(sql, params)
    names = [d[0] for d in cur.description]
    recs = [dict(zip(names, r)) for r in cur.fetchall()]
    if args.json:
        print(json.dumps(recs, ensure_ascii=False, indent=2, default=str))
        return
    headers = ["session", "project", "title", "reqs", "total", "cache_read", "output", "errs", "last_active"]
    rows = []
    for r in recs:
        rows.append([short_sess(r["session_id"]), short_dir(r["MAX(s.directory)"]),
                     (r["MAX(s.title)"] or "")[:38], r["reqs"], fmt_tokens(r["total"]),
                     fmt_tokens(r["cache_read"]), fmt_tokens(r["output"]), r["errors"] or 0, r["last"]])
    print_table(headers, rows, False)


def cmd_detail(con, args):
    where, params = apply_filters(args)
    where = (where + " AND " if where else "WHERE ") + "m.session_id LIKE ?"
    params = params + ["%" + args.session_id + "%"]
    sql = ("SELECT CAST(m.started_at AS INTEGER) ts, m.query_source, m.agent, m.model_id, m.variant, "
           "CAST(m.input_tokens AS INTEGER) inp, COALESCE(CAST(m.cache_read_input_tokens AS INTEGER),0) cr, "
           "COALESCE(CAST(m.cache_creation_input_tokens AS INTEGER),0) cw, CAST(m.output_tokens AS INTEGER) outp, "
           "CAST(m.reasoning_tokens AS INTEGER) rsn, m.status, m.duration_ms, m.error_message "
           + FROM_SQL + " " + where + " ORDER BY ts")
    recs = [dict(zip(["ts", "kind", "agent", "model", "variant", "inp", "cr", "cw", "outp", "rsn", "status", "ms", "err"], r))
            for r in con.execute(sql, params)]
    if not recs:
        raise SystemExit("zcode-wallet: no requests match session %r" % args.session_id)
    if args.json:
        print(json.dumps(recs, ensure_ascii=False, indent=2, default=str))
        return
    headers = ["time", "kind", "model", "in_total", "cache_r/w", "out", "rsn", "ms", "status"]
    rows, prev_ctx = [], None
    for r in recs:
        if r["kind"] == "main_turn" and r["status"] == "completed" and r["inp"]:
            if prev_ctx and r["inp"] < prev_ctx * 0.6 and prev_ctx > 20000:
                rows.append(["  << compaction: context %s -> %s (-%s)" % (
                    fmt_tokens(prev_ctx), fmt_tokens(r["inp"]), fmt_tokens(prev_ctx - r["inp"]))] + [""] * (len(headers) - 1))
            prev_ctx = r["inp"]
        t = datetime.fromtimestamp(r["ts"] / 1000).strftime("%m-%d %H:%M:%S") if r["ts"] else "?"
        rows.append([t, KIND_LABEL.get(r["kind"], r["kind"] or "?"), "%s/%s" % (r["model"], r["variant"] or "-"),
                     fmt_tokens(r["inp"]), "%s/%s" % (fmt_tokens(r["cr"]), fmt_tokens(r["cw"])),
                     fmt_tokens(r["outp"]), fmt_tokens(r["rsn"]), r["ms"] or "", r["status"] + (" " + r["err"][:30] if r["err"] else "")])
    print_table(headers, rows, False)
    tot_in = sum(r["inp"] or 0 for r in recs)
    tot_out = sum(r["outp"] or 0 for r in recs)
    print("-- session totals: requests %d | in %s | out %s | total %s" % (
        len(recs), fmt_tokens(tot_in), fmt_tokens(tot_out), fmt_tokens(tot_in + tot_out)))


def cmd_compactions(con, args):
    where, params = apply_filters(args)
    base = FROM_SQL + ((" " + where + " AND ") if where else " WHERE ")
    n_compact = con.execute("SELECT COUNT(*) " + base + "m.query_source='compact'", params).fetchone()[0]
    cost = con.execute("SELECT %s %s %s m.query_source='compact'" % (
        AGG_SQL[AGG_SQL.index("COUNT(*)"):], FROM_SQL, (" WHERE " + where[6:] + " AND ") if where else " WHERE "), params).fetchone()
    sql = ("SELECT m.session_id, s.directory, CAST(m.started_at AS INTEGER) ts, "
           "COALESCE(CAST(m.input_tokens AS INTEGER), 0) "
           + FROM_SQL + " " + where +
           ((" AND " if where else " WHERE ") + "m.query_source='compact'") + " ORDER BY m.session_id, ts")
    events, seen = [], set()
    for sid, directory, ts, own_input in con.execute(sql, params).fetchall():
        if (sid, ts) in seen:
            continue
        seen.add((sid, ts))
        after = con.execute(
            "SELECT CAST(m.input_tokens AS INTEGER) FROM model_usage m WHERE m.session_id=? AND m.status='completed' "
            "AND m.query_source='main_turn' AND CAST(m.started_at AS INTEGER) > ? AND COALESCE(CAST(m.input_tokens AS INTEGER),0) > 0 "
            "ORDER BY CAST(m.started_at AS INTEGER) LIMIT 1", (sid, ts)).fetchone()
        before = con.execute(
            "SELECT COALESCE(CAST(m.input_tokens AS INTEGER),0) FROM model_usage m WHERE m.session_id=? AND m.status='completed' "
            "AND CAST(m.started_at AS INTEGER) < ? ORDER BY CAST(m.started_at AS INTEGER) DESC LIMIT 1", (sid, ts)).fetchone()
        b = before[0] if before else 0
        if not b:  # no measurable predecessor: the compact request's own input ~ the old context
            b = own_input
        a = after[0] if after else 0
        events.append({"session": sid, "project": short_dir(directory), "time": datetime.fromtimestamp(ts / 1000).strftime("%Y-%m-%d %H:%M"),
                       "context_before": b, "context_after": a, "dropped": max(b - a, 0)})
    if args.json:
        print(json.dumps({"compact_requests": n_compact, "compact_request_tokens": cost[1] if cost else 0, "events": events},
                         ensure_ascii=False, indent=2, default=str))
        return
    print("ZCode-recorded compaction requests: %d  (their own token cost: %s)" % (n_compact, fmt_tokens(cost[1] if cost else 0)))
    print("Each compaction throws away the old context; everything below 'dropped' stops being re-sent (and re-billed) on later turns.\n")
    rows = [[e["time"], e["project"], short_sess(e["session"]), fmt_tokens(e["context_before"]),
             fmt_tokens(e["context_after"]), fmt_tokens(e["dropped"])] for e in events]
    print_table(["time", "project", "session", "ctx_before", "ctx_after", "dropped"], rows, False)
    print("\ntotal dropped context: %s tokens" % fmt_tokens(sum(e["dropped"] for e in events)))


def cmd_projects(con, args):
    ns = argparse.Namespace(**{**vars(args), "group": ["project"], "order": None})
    cmd_by(con, ns)


# ---------------------------------------------------------------- pricing

PRICE_SYMBOL = {"CNY": "¥", "USD": "$"}


def load_prices(path):
    if not os.path.exists(path):
        return {}
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def in_peak_utc(ts, peak):
    """peak: {'hours_utc': [[a,b),...], 'weekdays_only': bool} evaluated in UTC."""
    if not peak:
        return False
    t = time.gmtime(ts / 1000.0)
    if peak.get("weekdays_only") and t.tm_wday >= 5:
        return False
    return any(a <= t.tm_hour < b for a, b in peak.get("hours_utc", []))


def resolve_price(prices, provider, model, ts):
    """Point-in-time lookup: newest entry with as_of <= usage date; reuse
    earliest known entry when usage predates every record. More specific
    'provider|model' keys win over global model keys."""
    hist = prices.get("history", {})
    base = prices.get("aliases", {}).get(model, model)
    for key in (provider + "|" + model, provider + "|" + base, model, base):
        entries = hist.get(key)
        if not entries:
            continue
        d = datetime.fromtimestamp(ts / 1000).strftime("%Y-%m-%d")
        eligible = [e for e in entries if e.get("as_of", "") <= d]
        pick = max(eligible, key=lambda e: e.get("as_of", "")) if eligible else min(entries, key=lambda e: e.get("as_of", ""))
        return pick
    return None


def row_cost(entry, fresh, cr, cw, outp, peak):
    tier = entry.get("price", {})
    if peak and entry.get("peak_price"):
        tier = entry["peak_price"]
    return (fresh * tier.get("input", 0) + cr * tier.get("cache_read", 0)
            + cw * tier.get("cache_write", 0) + outp * tier.get("output", 0)) / 1e6


def fmt_money(v, currency):
    if v is None:
        return "-"
    return "%s%.2f" % (PRICE_SYMBOL.get(currency, ""), v)


def new_agg():
    return {"reqs": 0, "tokens": 0, "weighted": 0.0, "cost": 0.0, "currency": None,
            "priced": False, "peaked": False, "fresh": 0, "cr": 0, "cw": 0, "out": 0}


def cmd_costs(con, args):
    cfg = load_prices(args.prices)
    providers = cfg.get("providers", {})
    where, params = apply_filters(args)
    sql = ("SELECT m.provider_id, m.model_id, CAST(m.started_at AS INTEGER) ts, "
           "CAST(m.input_tokens AS INTEGER), COALESCE(CAST(m.cache_read_input_tokens AS INTEGER),0), "
           "COALESCE(CAST(m.cache_creation_input_tokens AS INTEGER),0), COALESCE(CAST(m.output_tokens AS INTEGER),0) "
           + FROM_SQL + " " + where)
    by_prov, by_prov_model = {}, {}
    fx = cfg.get("fx", {}).get("USD_CNY", 7.2)
    for pid, model, ts, inp, cr, cw, outp in con.execute(sql, params).fetchall():
        cr, cw, outp = cr or 0, cw or 0, outp or 0
        inp = max(inp or 0, 0)
        fresh = max(inp - cr - cw, 0)
        tok = fresh + cr + cw + outp
        pcfg = providers.get(pid, {})
        ptype = pcfg.get("type", "unknown")
        is_peak = in_peak_utc(ts, pcfg.get("peak"))
        a = by_prov.setdefault(pid, new_agg())
        b = by_prov_model.setdefault((pid, model), new_agg())
        for agg in (a, b):
            agg["reqs"] += 1
            agg["tokens"] += tok
            agg["fresh"] += fresh
            agg["cr"] += cr
            agg["cw"] += cw
            agg["out"] += outp
        if ptype == "plan":
            peak_cfg = pcfg.get("peak") or {}
            factor = 1.0 if is_peak else peak_cfg.get("offpeak_factor", 0.5)
            a["weighted"] += tok * factor
        elif ptype == "pay":
            entry = resolve_price(cfg, pid, model, ts)
            if entry:
                peak_win = {"hours_utc": entry.get("peak_hours_utc", []),
                            "weekdays_only": entry.get("peak_weekdays_only", False)}
                is_peak_pay = bool(entry.get("peak_price")) and in_peak_utc(ts, peak_win)
                cost = row_cost(entry, fresh, cr, cw, outp, is_peak_pay)
                a["cost"] += cost
                b["cost"] += cost
                a["priced"] = b["priced"] = True
                a["currency"] = b["currency"] = entry.get("currency")
                if is_peak_pay:
                    a["peaked"] = b["peaked"] = True

    label = lambda pid: providers.get(pid, {}).get("label", pid)
    if args.json:
        out = {"fx_usd_cny": fx, "providers": [], "models": []}
        for pid, a in by_prov.items():
            rec = {"provider": pid, "label": label(pid), "type": providers.get(pid, {}).get("type", "unknown"), **a}
            rec["cost_cny"] = round(a["cost"] * (fx if a["currency"] == "USD" else 1.0), 4) if a["priced"] else None
            q = providers.get(pid, {}).get("quota", {}).get("weekly")
            if providers.get(pid, {}).get("type") == "plan" and q:
                rec["quota_weekly"] = q
                rec["quota_pct"] = round(100.0 * a["weighted"] / q, 2) if q else None
            out["providers"].append(rec)
        for (pid, model), b in by_prov_model.items():
            out["models"].append({"provider": pid, "model": model, **b})
        print(json.dumps(out, ensure_ascii=False, indent=2, default=str))
        return

    scope = (" | 过滤范围: " + " ".join(x for x in [args.since and "since " + args.since,
             args.until and "until " + args.until, args.provider, args.model, args.project] if x)) if (
        args.since or args.until or args.provider or args.model or args.project) else ""
    usd_used = any(a["priced"] and a["currency"] == "USD" for a in by_prov.values())
    print("计费估算(¥)%s  峰谷按 UTC 判定%s" % (scope, "  [USD 按 %s 折算]" % fx if usd_used else ""))
    headers = ["provider", "type", "reqs", "tokens", "积分加权", "cost(¥)", "note"]
    rows = []
    cny_total = 0.0
    for pid, a in sorted(by_prov.items(), key=lambda kv: -kv[1]["tokens"]):
        pcfg = providers.get(pid, {})
        ptype = pcfg.get("type", "unknown")
        note = ""
        cost_s = "-"
        weighted_s = "-"
        if ptype == "plan":
            weighted_s = fmt_tokens(int(a["weighted"]))
            q = (pcfg.get("quota") or {}).get("weekly")
            if q:
                note = "%.1f%% of %s/周(峰谷加权)" % (100.0 * a["weighted"] / q, fmt_tokens(q))
            else:
                note = "未配置配额"
        elif ptype == "included":
            note = "套餐内,不计费"
        elif ptype == "free":
            note = "free"
        elif ptype == "pay":
            if a["priced"]:
                cny = a["cost"] * (fx if a["currency"] == "USD" else 1.0)
                cny_total += cny
                cost_s = "¥%.2f" % cny
                note = "峰谷计价" if a["peaked"] else "平价"
            else:
                note = "未配置价格(补: price add)"
        else:
            note = "未知提供商"
        rows.append([label(pid), ptype, a["reqs"], fmt_tokens(a["tokens"]), weighted_s, cost_s, note])
    print_table(headers, rows, False)
    if cny_total:
        print("合计: ¥%.2f" % cny_total)

    print("\n按模型(仅 pay 类):")
    mrows = []
    for (pid, model), b in sorted(by_prov_model.items(), key=lambda kv: -kv[1]["cost"]):
        if providers.get(pid, {}).get("type") != "pay" or not b["priced"]:
            continue
        cny = b["cost"] * (fx if b["currency"] == "USD" else 1.0)
        mrows.append(["%s / %s" % (label(pid), model), b["reqs"], fmt_tokens(b["tokens"]),
                      fmt_tokens(b["fresh"]), fmt_tokens(b["cr"]), fmt_tokens(b["out"]),
                      "¥%.2f" % cny])
    if mrows:
        print_table(["provider/model", "reqs", "tokens", "fresh_in", "cache_read", "output", "cost"], mrows, False)
    else:
        print("  (无)")


def cmd_price(args):
    path = args.prices
    cfg = load_prices(path) if os.path.exists(path) else {"version": 1, "history": {}}
    hist = cfg.setdefault("history", {})
    if args.price_cmd == "list":
        keys = sorted(hist)
        if args.model:
            base = cfg.get("aliases", {}).get(args.model, args.model)
            keys = [k for k in keys if args.model in k or base == k.split("|")[-1]]
        if not keys:
            print("no price records" + (" for %r" % args.model if args.model else ""))
            return
        for k in keys:
            print("== %s ==" % k)
            for e in sorted(hist[k], key=lambda x: x.get("as_of", "")):
                pp = e.get("peak_price")
                p = e.get("price", {})
                line = "  %s  %s  in %s / cache %s / out %s  [%s]" % (
                    e.get("as_of"), e.get("currency", "?"), p.get("input"), p.get("cache_read"), p.get("output"),
                    (e.get("source") or "")[:60])
                if pp:
                    line += "\n      peak: in %s / cache %s / out %s  (UTC %s, weekdays_only=%s)" % (
                        pp.get("input"), pp.get("cache_read"), pp.get("output"),
                        e.get("peak_hours_utc"), e.get("peak_weekdays_only"))
                if e.get("note"):
                    line += "\n      note: " + e["note"]
                print(line)
        return
    # add
    entry = {"as_of": args.date or time.strftime("%Y-%m-%d"),
             "source": args.source, "currency": args.currency.upper(),
             "price": {"input": args.input, "cache_read": args.cache_read or 0,
                       "cache_write": args.cache_write or 0, "output": args.output},
             "peak_price": None}
    if args.peak_input is not None or args.peak_output is not None:
        if not (args.peak_hours or args.peak_hours_utc):
            raise SystemExit("zcode-wallet: peak prices need --peak-hours-utc (e.g. '1-4,6-10')")
        windows = args.peak_hours_utc
        if not windows and args.peak_hours:
            off = args.utc_offset if args.utc_offset is not None else 8
            windows = [[max(a - off, 0), max(b - off, 0)] for a, b in args.peak_hours]
        entry["peak_price"] = {"input": args.peak_input or 0, "cache_read": args.peak_cache_read or 0,
                               "cache_write": 0, "output": args.peak_output or 0}
        entry["peak_hours_utc"] = windows
        entry["peak_weekdays_only"] = bool(args.peak_weekdays_only)
    if args.note:
        entry["note"] = args.note
    key = (args.provider + "|" + args.model) if args.provider else args.model
    hist.setdefault(key, []).append(entry)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)
    print("recorded: %s @ %s (%s)" % (key, entry["as_of"], entry["currency"]))


# ---------------------------------------------------------------- main

def main(argv=None):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    p = argparse.ArgumentParser(prog="zcode-wallet", description="Read-only token/quota analytics for ZCode's local ledger.")
    p.add_argument("--db", default=os.environ.get("ZCODE_DB", DEFAULT_DB), help="path to ZCode db.sqlite")
    p.add_argument("--json", action="store_true", help="machine-readable output")
    p.add_argument("--prices", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "prices.json"),
                   help="price history file (default: prices.json next to this script)")
    sub = p.add_subparsers(dest="cmd", required=True)

    def add_filters(sp):
        sp.add_argument("--json", action="store_true", default=argparse.SUPPRESS,
                        help="machine-readable output (also available globally)")
        sp.add_argument("--provider", help="substring match, e.g. bigmodel / zai / a UUID")
        sp.add_argument("--model", help="substring match, e.g. GLM-5.3")
        sp.add_argument("--agent", help="substring match, e.g. Explore / general-purpose")
        sp.add_argument("--kind", help="query_source: main_turn / subagent / compact / session_title")
        sp.add_argument("--mode", help="yolo / plan / build / edit")
        sp.add_argument("--task", help="task_type substring")
        sp.add_argument("--project", help="workspace directory substring")
        sp.add_argument("--session", help="session id substring")
        sp.add_argument("--status", help="completed / error / ...")
        sp.add_argument("--errors-only", action="store_true")
        sp.add_argument("--since", help="7d / 24h / 2026-09-01")
        sp.add_argument("--until", help="exclusive upper bound")

    sp = sub.add_parser("summary", help="overall totals + cache split + quota pace")
    sp.add_argument("--quota", type=float, help="weekly quota in tokens, e.g. 6e8 for 600M")
    add_filters(sp)
    sp.set_defaults(func="summary")

    sp = sub.add_parser("by", help="grouped aggregation")
    sp.add_argument("--group", action="append", choices=sorted(GROUPS), required=True,
                    help="dimension (repeat once more for two-level grouping)")
    sp.add_argument("--order", default=None, choices=["total", "requests", "output", "fresh_in", "cache_read"],
                    help="sort key (default: total, or chronological for day/week/hour)")
    sp.add_argument("--limit", type=int, default=30)
    add_filters(sp)
    sp.set_defaults(func="by")

    sp = sub.add_parser("sessions", help="recent sessions with burn")
    sp.add_argument("--limit", type=int, default=15)
    add_filters(sp)
    sp.set_defaults(func="sessions")

    sp = sub.add_parser("detail", help="per-request timeline of one session (prefix ok)")
    sp.add_argument("session_id")
    add_filters(sp)
    sp.set_defaults(func="detail")

    sp = sub.add_parser("compactions", help="compaction events + dropped-context estimate")
    add_filters(sp)
    sp.set_defaults(func="compactions")

    sp = sub.add_parser("projects", help="totals per workspace directory")
    sp.add_argument("--limit", type=int, default=30)
    add_filters(sp)
    sp.set_defaults(func="projects")

    sp = sub.add_parser("costs", help="billing estimate: plan -> quota %%, pay -> money (peak/off-peak aware)")
    add_filters(sp)
    sp.set_defaults(func="costs")

    sp = sub.add_parser("price", help="price history: list / add")
    sp.add_argument("price_cmd", choices=["list", "add"])
    sp.add_argument("model", nargs="?", help="model name for add, or filter for list")
    sp.add_argument("--provider", help="scope the record to one provider (key 'provider|model')")
    sp.add_argument("--currency", default="USD", help="USD / CNY / ...")
    sp.add_argument("--input", type=float, help="price per 1M input tokens")
    sp.add_argument("--cache-read", type=float, help="price per 1M cached input tokens")
    sp.add_argument("--cache-write", type=float)
    sp.add_argument("--output", type=float, help="price per 1M output tokens")
    sp.add_argument("--peak-input", type=float)
    sp.add_argument("--peak-cache-read", type=float)
    sp.add_argument("--peak-output", type=float)
    sp.add_argument("--peak-hours-utc", help="peak windows in UTC, e.g. '1-4,6-10'")
    sp.add_argument("--peak-hours", help="peak windows in UTC+8 (decoded via --utc-offset), e.g. '14-18'")
    sp.add_argument("--utc-offset", type=int, default=8, help="offset applied to --peak-hours")
    sp.add_argument("--peak-weekdays-only", action="store_true")
    sp.add_argument("--source", help="URL or provenance of the quote")
    sp.add_argument("--date", help="as_of date YYYY-MM-DD (default today)")
    sp.add_argument("--note", help="free-text note")
    sp.set_defaults(func="price")

    args = p.parse_args(argv)
    if args.func == "price":
        return cmd_price(args)
    con, note = open_db(args.db)
    args.db_note = note
    try:
        if args.func == "summary":
            render_summary(con, args)
        elif args.func == "by":
            cmd_by(con, args)
        elif args.func == "sessions":
            cmd_sessions(con, args)
        elif args.func == "detail":
            cmd_detail(con, args)
        elif args.func == "compactions":
            cmd_compactions(con, args)
        elif args.func == "projects":
            cmd_projects(con, args)
        elif args.func == "costs":
            cmd_costs(con, args)
    finally:
        con.close()


if __name__ == "__main__":
    main()
