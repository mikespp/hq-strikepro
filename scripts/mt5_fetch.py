#!/usr/bin/env python3
"""
พอร์ต Master fetcher — loops each MT5 master account, reads balance/equity + the
day's deposits/withdrawals, and pushes an hourly snapshot to HQ
(/api/portfolio/sync). HQ computes the time-weighted (deposit-neutral) returns.

The account list + INVESTOR passwords are managed on the HQ admin page
(/portfolio-admin) and fetched here over the sync-key channel — nothing is stored
on the VPS. Run on the Windows VPS where the MT5 terminal is installed, every hour
via Task Scheduler. One terminal handles one login at a time, so we log in to each
account in sequence ("วน login").

Setup:
    pip install MetaTrader5 requests
    env:  HQ_URL=https://hq-strikepro-production.up.railway.app   (optional)
          SYNC_KEY=<same as HQ ELIGIBILITY_SYNC_KEY>              (or C:\\xampp\\check-email.key)
          MT5_TERMINAL=C:\\Path\\to\\terminal64.exe               (optional)
"""

import os, sys, datetime as dt
import requests
import MetaTrader5 as mt5

HQ_URL   = os.environ.get("HQ_URL", "https://hq-strikepro-production.up.railway.app").rstrip("/")
SYNC_KEY = os.environ.get("SYNC_KEY", "")
TERMINAL = os.environ.get("MT5_TERMINAL")  # optional explicit terminal path

# Fall back to the shared key file used by the other VPS jobs (check-email.php etc.)
if not SYNC_KEY:
    try:
        with open(r"C:\xampp\check-email.key", encoding="utf-8") as f:
            SYNC_KEY = f.read().strip()
    except OSError:
        pass

def load_accounts():
    """Pull the master list + investor passwords from HQ (sync-key protected)."""
    r = requests.get(f"{HQ_URL}/api/portfolio/accounts",
                     headers={"X-Sync-Key": SYNC_KEY}, timeout=30)
    r.raise_for_status()
    return r.json()

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
        print("SYNC_KEY not set (env SYNC_KEY or C:\\xampp\\check-email.key)"); sys.exit(1)
    try:
        accounts = load_accounts()
    except Exception as e:
        print("failed to fetch account list from HQ:", e); sys.exit(1)
    if not accounts:
        print("no active master accounts on HQ — add them at /portfolio-admin"); return
    if not mt5.initialize(**({"path": TERMINAL} if TERMINAL else {})):
        print("mt5.initialize failed:", mt5.last_error()); sys.exit(1)

    today = dt.date.today().isoformat()
    acct_payload, snap_payload = [], []

    for a in accounts:
        login = int(a["login"])
        pw = a.get("investor_password") or a.get("password", "")
        ok = mt5.login(login, password=pw, server=a.get("server", ""))
        if not ok:
            print(f"[{login}] login failed:", mt5.last_error()); continue
        info = mt5.account_info()
        if info is None:
            print(f"[{login}] account_info None:", mt5.last_error()); continue
        deposit, withdrawal = day_flows(login)
        # label is owned by the HQ admin page — send server/currency only (don't overwrite it)
        acct_payload.append({ "login": login, "server": a.get("server", ""), "currency": info.currency })
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
