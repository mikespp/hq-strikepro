// Myfxbook-style fund performance from daily account snapshots.
//
// Input rows: [{ login, d:'YYYY-MM-DD', balance, equity, deposit, withdrawal }]
//   deposit/withdrawal = cash moved on that day (both stored as positive amounts).
//
// Return = TIME-WEIGHTED: each day's return excludes deposits/withdrawals, then we
// compound. The fund aggregate is a capital-weighted blend of per-account daily
// returns, so an account joining/leaving the fund doesn't distort the curve.

function round(n, p = 4) { const f = Math.pow(10, p); return Math.round((Number(n) || 0) * f) / f; }

// Per-account daily time-weighted returns from its sorted snapshots.
function accountReturns(rows) {
  const s = rows.slice().sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
  const out = [];
  for (let i = 1; i < s.length; i++) {
    const prev = s[i - 1], cur = s[i];
    const prevEq = Number(prev.equity) || 0;
    if (prevEq <= 0) continue;                              // can't compute a return on 0 capital
    const flow = (Number(cur.deposit) || 0) - (Number(cur.withdrawal) || 0);
    const r = (Number(cur.equity) - flow) / prevEq - 1;     // deposit/withdrawal-neutral
    out.push({ d: cur.d, r, weight: prevEq });
  }
  return out;
}

function computeFund(rows) {
  // group by account
  const byLogin = new Map();
  for (const row of rows) {
    if (!byLogin.has(row.login)) byLogin.set(row.login, []);
    byLogin.get(row.login).push(row);
  }

  // per-account cumulative gain + latest equity
  const accounts = [];
  const dayAgg = new Map(); // d -> { wsum, wr }  (capital-weighted daily return)
  const monthOf = m => m.slice(0, 7);
  const nowMonth = new Date().toISOString().slice(0, 7);

  for (const [login, arr] of byLogin) {
    const sorted = arr.slice().sort((a, b) => (a.d < b.d ? -1 : 1));
    const rets = accountReturns(sorted);
    let cf = 1, cfMonth = 1;
    for (const x of rets) {
      cf *= (1 + x.r);
      if (monthOf(x.d) === nowMonth) cfMonth *= (1 + x.r);
      const a = dayAgg.get(x.d) || { wsum: 0, wr: 0 };
      a.wsum += x.weight; a.wr += x.weight * x.r;
      dayAgg.set(x.d, a);
    }
    const last = sorted[sorted.length - 1] || {};
    accounts.push({
      login,
      label: '',                          // filled by caller from pf_accounts
      equity: round(last.equity, 2),
      balance: round(last.balance, 2),
      deposits: round(sorted.reduce((s, r) => s + (Number(r.deposit) || 0), 0), 2),
      withdrawals: round(sorted.reduce((s, r) => s + (Number(r.withdrawal) || 0), 0), 2),
      gainCumulative: round((cf - 1) * 100, 2),
      gainMonth: round((cfMonth - 1) * 100, 2),
      lastDate: last.d || null,
    });
  }

  // fund aggregate: capital-weighted daily return, then compound
  const days = [...dayAgg.keys()].sort();
  let cf = 1, peak = 1, maxDD = 0;
  const curve = [];     // [{ d, gain }]  cumulative gain % (TWR)
  const monthCF = new Map();
  for (const d of days) {
    const a = dayAgg.get(d);
    const r = a.wsum > 0 ? a.wr / a.wsum : 0;
    cf *= (1 + r);
    if (cf > peak) peak = cf;
    const dd = (cf / peak - 1) * 100;
    if (dd < maxDD) maxDD = dd;
    curve.push({ d, gain: round((cf - 1) * 100, 2) });
    const mk = monthOf(d);
    monthCF.set(mk, (monthCF.get(mk) || 1) * (1 + r));
  }

  const monthly = [...monthCF.entries()].sort().map(([m, f]) => ({ month: m, gain: round((f - 1) * 100, 2) }));
  const lastDay = days.length ? dayAgg.get(days[days.length - 1]) : null;
  const gainToday = lastDay && lastDay.wsum > 0 ? round((lastDay.wr / lastDay.wsum) * 100, 2) : 0;
  const gainMonth = monthCF.has(nowMonth) ? round((monthCF.get(nowMonth) - 1) * 100, 2) : 0;

  return {
    fund: {
      equity:        round(accounts.reduce((s, a) => s + a.equity, 0), 2),
      balance:       round(accounts.reduce((s, a) => s + a.balance, 0), 2),
      deposits:      round(accounts.reduce((s, a) => s + a.deposits, 0), 2),
      withdrawals:   round(accounts.reduce((s, a) => s + a.withdrawals, 0), 2),
      accounts:      accounts.length,
      gainToday,
      gainMonth,
      gainCumulative: round((cf - 1) * 100, 2),
      maxDrawdown:   round(maxDD, 2),
    },
    curve,
    monthly,
    accounts: accounts.sort((a, b) => b.equity - a.equity),
  };
}

// ── พอร์ต Master ────────────────────────────────────────────────────────────────
// Input: rows from pf_masters (the StrikePro widget API's own figures). We don't
// recompute returns — the platform already gives deposit/withdrawal-neutral % (TWR).
// We only aggregate them into a fund view (AUM-weighted) and shape per-master curves.

function parseCurve(mini) {
  let arr = mini;
  if (typeof mini === 'string') { try { arr = JSON.parse(mini); } catch { arr = []; } }
  if (!Array.isArray(arr)) return [];
  return arr
    .map(p => ({ t: Number(p.timestamp ?? p.t) || 0, etwr: Number(p.etwr) || 0, equity: Number(p.equity) || 0 }))
    .filter(p => p.t > 0)
    .sort((a, b) => a.t - b.t);
}

// Downsample a curve to at most `max` points (keep first + last, even stride).
function downsample(curve, max = 60) {
  if (curve.length <= max) return curve;
  const step = (curve.length - 1) / (max - 1);
  const out = [];
  for (let i = 0; i < max; i++) out.push(curve[Math.round(i * step)]);
  return out;
}

function computeMasters(rows) {
  const masters = rows.map(r => {
    const curve = parseCurve(r.minichart);
    return {
      accountId:    String(r.account_id),
      name:         r.name || ('#' + r.account_id),
      currency:     r.currency || 'USD',
      aum:          round(r.aum, 2),
      balance:      round(r.balance, 2),
      equity:       round(r.equity, 2),
      followers:    parseInt(r.followers, 10) || 0,
      score:        round(r.score, 1),
      risk:         round(r.risk, 1),
      maxDrawdown:  round(r.max_dd, 2),
      profitFactor: round(r.profit_factor, 2),
      profitWeek:   round(r.p_week, 2),
      profitMonth:  round(r.p_month, 2),
      profit3m:     round(r.p_3m, 2),
      profit6m:     round(r.p_6m, 2),
      profit12m:    round(r.p_12m, 2),
      profitAll:    round(r.p_all, 2),
      curve:        downsample(curve, 60).map(p => ({ t: p.t, v: round(p.etwr, 2) })),
      _curveFull:   curve,
    };
  });

  // AUM-weighted fund blend of each period return.
  const totAum = masters.reduce((s, m) => s + (m.aum > 0 ? m.aum : 0), 0);
  const wAvg = key => {
    if (totAum <= 0) return 0;
    return round(masters.reduce((s, m) => s + (m.aum > 0 ? m.aum : 0) * m[key], 0) / totAum, 2);
  };

  // Fund cumulative-TWR curve: AUM-weighted blend of each master's etwr on a unified
  // timestamp grid (step-forward hold; a master contributes only once it has started).
  const tset = new Set();
  masters.forEach(m => m._curveFull.forEach(p => tset.add(p.t)));
  const ts = [...tset].sort((a, b) => a - b);
  const idx = masters.map(() => 0);
  const last = masters.map(() => null);
  let fundCurve = [];
  for (const t of ts) {
    masters.forEach((m, i) => {
      const c = m._curveFull;
      while (idx[i] < c.length && c[idx[i]].t <= t) { last[i] = c[idx[i]].etwr; idx[i]++; }
    });
    let wsum = 0, acc = 0;
    masters.forEach((m, i) => { if (last[i] != null && m.aum > 0) { wsum += m.aum; acc += m.aum * last[i]; } });
    if (wsum > 0) fundCurve.push({ t, v: round(acc / wsum, 2) });
  }
  fundCurve = downsample(fundCurve, 90);

  masters.forEach(m => { delete m._curveFull; });
  masters.sort((a, b) => b.aum - a.aum);

  return {
    fund: {
      masters:      masters.length,
      aum:          round(totAum, 2),
      equity:       round(masters.reduce((s, m) => s + m.equity, 0), 2),
      followers:    masters.reduce((s, m) => s + m.followers, 0),
      profitWeek:   wAvg('profitWeek'),
      profitMonth:  wAvg('profitMonth'),
      profit3m:     wAvg('profit3m'),
      profit6m:     wAvg('profit6m'),
      profit12m:    wAvg('profit12m'),
      profitAll:    wAvg('profitAll'),
      maxDrawdown:  wAvg('maxDrawdown'),
      profitFactor: wAvg('profitFactor'),
    },
    fundCurve,
    masters,
  };
}

module.exports = { computeFund, accountReturns, computeMasters };
