"""Analyst-style commentary written by rules from the reported numbers.

Every sentence is built from figures in the statements, so each one can be
checked against the filing. Rules only fire when their inputs exist: a bank
with no gross profit or capital expenditure line simply gets fewer points.
"""
from __future__ import annotations


def money(v: float) -> str:
    a = abs(v)
    s = "-" if v < 0 else ""
    if a >= 1e12:
        return f"{s}${a / 1e12:.2f} trillion"
    if a >= 1e9:
        return f"{s}${a / 1e9:.1f} billion"
    if a >= 1e6:
        return f"{s}${a / 1e6:.0f} million"
    return f"{s}${a:,.0f}"


def pct(v: float, dp: int = 1) -> str:
    return f"{abs(v) * 100:.{dp}f}%"


def pts(v: float) -> str:
    return f"{abs(v) * 100:.1f} percentage points"


def _get(lines: dict, key: str, i: int):
    arr = lines.get(key) or []
    return arr[i] if -len(arr) <= i < len(arr) else None


def _ratio(a, b):
    return a / b if a is not None and b not in (None, 0) else None


def _cagr(a, b, n):
    return (a / b) ** (1 / n) - 1 if a and b and a > 0 and b > 0 and n > 0 else None


def generate(fin: dict, seg: dict | None = None, financial: bool = False) -> dict:
    A = fin["annual"]
    L, P = A["lines"], A["periods"]
    if len(P) < 2:
        return {"sections": [], "period": None}
    fy, prev_fy = P[-1]["label"], P[-2]["label"]
    g = lambda k, i=-1: _get(L, k, i)
    out: list[tuple[str, list[str]]] = []

    # Growth
    pts_ = []
    rev, rev0 = g("revenue"), g("revenue", -2)
    if rev and rev0:
        growth = rev / rev0 - 1
        verb = "rose" if growth >= 0 else "fell"
        s = f"Revenue {verb} {pct(growth)} to {money(rev)} in {fy}"
        if len(P) >= 5:
            base = _cagr(rev0, g("revenue", -5), 3)
            if base is not None:
                if growth > base + 0.02:
                    s += f", faster than the {pct(base)} annual rate of the three years before, so growth is accelerating"
                elif growth < base - 0.02:
                    s += f", slower than the {pct(base)} annual rate of the three years before, so growth is decelerating"
                else:
                    s += f", in line with the {pct(base)} annual rate of the three years before"
        pts_.append(s + ".")
        if growth < 0:
            pts_.append("A decline in revenue deserves a close read of the MD&A for whether it reflects pricing, volume or a business exited.")
    ni, ni0 = g("netIncome"), g("netIncome", -2)
    if rev and rev0 and ni and ni0 and ni0 > 0 and ni > 0:
        ng, rg = ni / ni0 - 1, rev / rev0 - 1
        nd = f"{'grew' if ng >= 0 else 'fell'} {pct(ng)}"
        rd = f"revenue {'growth' if rg >= 0 else 'decline'} of {pct(rg)}"
        if ng > rg + 0.03:
            pts_.append(f"Net income {nd}, ahead of {rd}, so more of each dollar of sales reached the bottom line.")
        elif ng < rg - 0.03:
            pts_.append(f"Net income {nd}, behind {rd}; costs grew faster than sales.")
    elif ni is not None and ni0 is not None and (ni < 0) != (ni0 < 0):
        pts_.append(f"The company swung to a net {'loss' if ni < 0 else 'profit'} of {money(abs(ni))} in {fy}.")
    sh, sh0 = g("sharesDiluted"), g("sharesDiluted", -2)
    if sh and sh0:
        c = sh / sh0 - 1
        if c < -0.01:
            pts_.append(f"The diluted share count fell {pct(c)}, which lifts earnings per share beyond the growth in net income.")
        elif c > 0.02:
            pts_.append(f"The diluted share count rose {pct(c)}, diluting existing shareholders.")
    out.append(("Growth", pts_))

    # Profitability
    pts_ = []
    for key, label in (("grossProfit", "Gross margin"), ("operatingIncome", "Operating margin")):
        m, m0 = _ratio(g(key), rev), _ratio(g(key, -2), rev0)
        if m is None or m0 is None:
            continue
        d = m - m0
        hist = [_ratio(_get(L, key, i), _get(L, "revenue", i)) for i in range(-len(P), 0)]
        hist = [h for h in hist if h is not None]
        extra = ""
        if len(hist) >= 5 and m >= max(hist) - 1e-9:
            extra = f", the highest in the {len(hist)} years shown"
        elif len(hist) >= 5 and m <= min(hist) + 1e-9:
            extra = f", the lowest in the {len(hist)} years shown"
        if abs(d) < 0.005:
            pts_.append(f"{label} held steady at {pct(m)}{extra}.")
        elif d > 0:
            pts_.append(f"{label} expanded {pts(d)} to {pct(m)}{extra}{', suggesting improving efficiency' if key == 'operatingIncome' else ''}.")
        else:
            pts_.append(f"{label} contracted {pts(d)} to {pct(m)}{extra}{', a sign costs are growing faster than revenue' if key == 'operatingIncome' else ''}.")
    rnd = _ratio(g("rnd"), rev)
    if rnd and rnd > 0.08:
        pts_.append(f"Research and development consumed {pct(rnd)} of revenue.")
    tax = _ratio(g("incomeTax"), g("pretaxIncome"))
    if tax is not None and 0 < tax < 0.6:
        pts_.append(f"The effective tax rate was {pct(tax)}, against a 21% U.S. federal statutory rate.")
    out.append(("Profitability", pts_))

    # Cash flow
    pts_ = []
    cfo, capex, fcf, fcf0 = g("cfo"), g("capex"), g("fcf"), g("fcf", -2)
    if fcf is not None:
        if fcf > 0:
            s = f"Free cash flow was {money(fcf)}, positive and supporting financial flexibility"
            conv = _ratio(fcf, ni) if ni and ni > 0 else None
            if conv is not None:
                s += f"; it equaled {pct(conv, 0)} of net income"
            pts_.append(s + ".")
        else:
            pts_.append(f"Free cash flow was negative at {money(fcf)}, so the business consumed cash after investment.")
        if fcf0 and fcf0 > 0 and fcf > 0 and abs(fcf / fcf0 - 1) > 0.05:
            pts_.append(f"That is {'up' if fcf > fcf0 else 'down'} {pct(fcf / fcf0 - 1)} from {prev_fy}.")
    capex0 = g("capex", -2)
    if capex and capex0 and rev:
        cg = capex / capex0 - 1
        if cg > 0.25:
            pts_.append(f"Capital expenditures rose {pct(cg)} to {money(capex)}, {pct(capex / rev)} of revenue, a heavy reinvestment year that holds free cash flow back.")
        elif cg < -0.2:
            pts_.append(f"Capital expenditures fell {pct(cg)} to {money(capex)}.")
    sbc = _ratio(g("sbc"), rev)
    if sbc and sbc > 0.05:
        pts_.append(f"Stock-based compensation equals {pct(sbc)} of revenue. It is added back in cash from operations, so free cash flow overstates owner earnings by that amount.")
    out.append(("Cash flow", pts_))

    # Balance sheet
    pts_ = []
    debt, eq, nd, ebitda = g("totalDebt"), g("equity"), g("netDebt"), g("ebitda")
    if financial:
        # Deposits and trading liabilities fund a bank; debt ratios built for industrial companies mislead.
        debt = nd = None
        eq_assets = _ratio(eq, g("totalAssets"))
        if eq_assets:
            pts_.append(f"Shareholders' equity is {pct(eq_assets)} of total assets. Bank leverage is judged by regulatory capital ratios, which are disclosed in the MD&A rather than tagged in XBRL.")
    if nd is not None:
        if nd < 0:
            pts_.append(f"Cash and short-term investments exceed debt, leaving net cash of {money(-nd)}.")
        elif ebitda and ebitda > 0:
            lev = nd / ebitda
            word = "low" if lev < 1 else "moderate" if lev < 3 else "elevated"
            pts_.append(f"Net debt of {money(nd)} is {lev:.1f} times EBITDA, a {word} level of leverage.")
    if debt is not None and eq and eq > 0:
        de = debt / eq
        pts_.append(f"Debt is {de:.2f} times shareholders' equity{', which is manageable' if de < 1 else ', a meaningful reliance on borrowing' if de > 2 else ''}.")
    elif eq is not None and eq < 0:
        pts_.append("Shareholders' equity is negative, usually the result of buybacks and dividends exceeding cumulative earnings rather than distress on its own.")
    cr = _ratio(g("currentAssets"), g("currentLiabilities"))
    if cr is not None and cr < 1:
        pts_.append(f"Current liabilities exceed current assets (current ratio {cr:.2f}).")
    gw = _ratio(g("goodwill"), g("totalAssets"))
    if gw and gw > 0.3:
        pts_.append(f"Goodwill is {pct(gw)} of total assets, a record of past acquisitions that could be impaired.")
    out.append(("Balance sheet", pts_))

    # Capital returns
    pts_ = []
    div, bb = g("dividends") or 0, g("buybacks") or 0
    if div + bb > 0:
        s = f"The company returned {money(div + bb)} to shareholders in {fy}"
        parts = [f"{money(div)} in dividends" if div else "", f"{money(bb)} in buybacks" if bb else ""]
        s += f" ({' and '.join(p for p in parts if p)})"
        if fcf and fcf > 0:
            s += f", {pct((div + bb) / fcf, 0)} of free cash flow"
        pts_.append(s + ".")
    out.append(("Capital returns", pts_))

    # Segments
    pts_ = []
    if seg and seg.get("breakdowns"):
        b = next((x for x in seg["breakdowns"] if x["axis"] == "segment"), seg["breakdowns"][0])
        top = [r for r in b["rows"] if not r.get("parent")]
        if len(top) >= 2 and len(b["years"]) >= 2 and not any(c and c > 1.03 for c in b["coverage"]):
            tot = b["total"][-1]
            big = max(top, key=lambda r: r["revenue"][-1] or 0)
            if tot and big["revenue"][-1]:
                pts_.append(f"{big['label']} is the largest {'region' if b['axis'] == 'geography' else 'segment'} at {pct(big['revenue'][-1] / tot)} of revenue.")
            growth = [(r, r["revenue"][-1] / r["revenue"][-2] - 1) for r in top if r["revenue"][-1] and r["revenue"][-2] and r["revenue"][-2] > 0]
            if len(growth) >= 2:
                fast = max(growth, key=lambda x: x[1])
                slow = min(growth, key=lambda x: x[1])
                pts_.append(f"{fast[0]['label']} grew fastest ({pct(fast[1])}); {slow[0]['label']} {'grew slowest' if slow[1] >= 0 else 'declined'} ({pct(slow[1])}).")
                if tot and b["total"][-2]:
                    shift = fast[0]["revenue"][-1] / tot - fast[0]["revenue"][-2] / b["total"][-2]
                    if shift > 0.01:
                        pts_.append(f"The mix is shifting toward {fast[0]['label']}, whose share of revenue rose {pts(shift)}.")
            with_oi = [r for r in top if r.get("operatingIncome") and r["operatingIncome"][-1] and r["revenue"][-1]]
            if len(with_oi) >= 2:
                best = max(with_oi, key=lambda r: r["operatingIncome"][-1] / r["revenue"][-1])
                pts_.append(f"{best['label']} carries the highest segment operating margin, {pct(best['operatingIncome'][-1] / best['revenue'][-1])}.")
    out.append(("Segments", pts_))

    # Latest quarter
    pts_ = []
    Q = fin["quarterly"]
    ql, qp = Q["lines"], Q["periods"]
    if len(qp) >= 5:
        r1, r0 = _get(ql, "revenue", -1), _get(ql, "revenue", -5)
        if r1 and r0:
            yoy = r1 / r0 - 1
            s = f"In the latest quarter ({qp[-1]['label']}), revenue {'grew' if yoy >= 0 else 'fell'} {pct(yoy)} from a year earlier"
            if rev and rev0:
                annual = rev / rev0 - 1
                s += ", faster than the last full year" if yoy > annual + 0.02 else ", slower than the last full year" if yoy < annual - 0.02 else ", in line with the last full year"
            pts_.append(s + ".")
        m1 = _ratio(_get(ql, "operatingIncome", -1), r1)
        m0 = _ratio(_get(ql, "operatingIncome", -5), r0)
        if m1 is not None and m0 is not None and abs(m1 - m0) >= 0.005:
            pts_.append(f"Quarterly operating margin {'widened' if m1 > m0 else 'narrowed'} {pts(m1 - m0)} year over year, to {pct(m1)}.")
    out.append(("Latest quarter", pts_))

    return {"period": fy, "sections": [{"topic": t, "points": p} for t, p in out if p]}
