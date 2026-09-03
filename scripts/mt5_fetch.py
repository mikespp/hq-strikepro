#!/usr/bin/env python3
"""
StrikePro fund fetcher — loops each MT5 account, reads balance/equity + the day's
deposits/withdrawals, and pushes a daily snapshot to HQ (/api/portfolio/sync).

Run on the Windows VPS where the MT5 terminal is installed (once/day via Task
Scheduler, or every N minutes to keep "today" fresh). One terminal handles one
login at a time, so we log in to each account in sequence ("วน login").

Setup:
    pip install MetaTrader5 requests
    set env:  HQ_URL=https://hq-strikepro-production.up.railway.app
              SYNC_KEY=<same as HQ ELIGIBILITY_SYNC_KEY>
              MT5_TERMINAL=C:\\Path\\to\\terminal64.exe   (optional)
    accounts.json next to this file:  [{ "login": 12345, "password": "<investor pw>",
                                         "server": "Broker-Server", "label": "PPVP #1" }, ...]
    (use the INVESTOR / read-only password — no trading rights needed)
"""

import os, json, sys, datetime as dt
import requests
import MetaTrader5 as mt5

HERE     = os.path.dirname(os.path.abspath(__file__))
HQ_URL   = os.environ.get("HQ_URL", "https://hq-strikepro-production.up.railway.app").rstrip("/")
SYNC_KEY = os.environ.get("SYNC_KEY", "")
TERMINAL = os.environ.get("MT5_TERMINAL")  # optional explicit terminal path

def load_accounts():
    with open(os.path.join(HERE, "accounts.json"), encoding="utf-8") as f:
        return json.load(f)

def day_flows(login):
    """Sum today's deposits (+) and withdrawals (-) from balance-type deals."""
    now = dt.datetime.now()
    start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    deals = mt5.history_deals_get(start, now) or []
    deposit = withdrawal = 0.0
    for dl in deals:
        if dl.type == mt5.DEAL_TYPE_BALANCE:      # deposit / withdrawal / balance op
            if dl.profit >= 0: deposit += dl.profit
            else:              withdrawal += -dl.profit
    return round(deposit, 2), round(withdrawal, 2)

def main():
    if not SYNC_KEY:
        print("SYNC_KEY not set"); sys.exit(1)
    accounts = load_accounts()
    if not mt5.initialize(**({"path": TERMINAL} if TERMINAL else {})):
        print("mt5.initialize failed:", mt5.last_error()); sys.exit(1)

    today = dt.date.today().isoformat()
    acct_payload, snap_payload = [], []

    for a in accounts:
        login = int(a["login"])
        ok = mt5.login(login, password=a.get("password", ""), server=a.get("server", ""))
        if not ok:
            print(f"[{login}] login failed:", mt5.last_error()); continue
        info = mt5.account_info()
        if info is None:
            print(f"[{login}] account_info None:", mt5.last_error()); continue
        deposit, withdrawal = day_flows(login)
        acct_payload.append({ "login": login, "label": a.get("label", ""),
                              "server": a.get("server", ""), "currency": info.currency })
        snap_payload.append({ "login": login, "d": today,
                              "balance": round(info.balance, 2), "equity": round(info.equity, 2),
                              "deposit": deposit, "withdrawal": withdrawal })
        print(f"[{login}] equity={info.equity:.2f} balance={info.balance:.2f} +{deposit}/-{withdrawal}")

    mt5.shutdown()

    if not snap_payload:
        print("nothing to push"); return
    r = requests.post(f"{HQ_URL}/api/portfolio/sync",
                      headers={"X-Sync-Key": SYNC_KEY, "Content-Type": "application/json"},
                      json={"accounts": acct_payload, "snapshots": snap_payload}, timeout=30)
    print("push:", r.status_code, r.text[:200])

if __name__ == "__main__":
    main()
