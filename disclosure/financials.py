"""Standardized financial statements from the SEC's XBRL company facts.

Companies tag the same line with different concepts, and change concepts
over time (Revenues to RevenueFromContractWithCustomer... after ASC 606).
Each line below lists its candidates in order of preference; for every
period the first candidate with a value is used, and the concept chosen is
reported so a figure can always be traced back to its tag.

Annual figures come from 10-K facts covering a full fiscal year. Quarterly
flows come from three-month facts; fourth quarters are not filed on their
own, so they are derived as the fiscal year less the first three quarters.
"""
from __future__ import annotations

from datetime import date

from . import sec
from .companies import submissions
from .sec import HOUR
from .store import memoize

# key: (label, statement, kind, candidates). kind: flow, instant, per_share, shares
LINES: list[tuple[str, str, str, str, list[str]]] = [
    ("revenue", "Revenue", "income", "flow", ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet", "RevenueFromContractWithCustomerIncludingAssessedTax", "RevenuesNetOfInterestExpense", "SalesRevenueGoodsNet"]),
    ("costOfRevenue", "Cost of revenue", "income", "flow", ["CostOfRevenue", "CostOfGoodsAndServicesSold", "CostOfGoodsSold", "CostOfServices", "CostOfGoodsAndServiceExcludingDepreciationDepletionAndAmortization"]),
    ("grossProfit", "Gross profit", "income", "flow", ["GrossProfit"]),
    ("rnd", "Research and development", "income", "flow", ["ResearchAndDevelopmentExpense", "ResearchAndDevelopmentExpenseExcludingAcquiredInProcessCost"]),
    ("sga", "Selling, general and administrative", "income", "flow", ["SellingGeneralAndAdministrativeExpense"]),
    ("operatingIncome", "Operating income", "income", "flow", ["OperatingIncomeLoss"]),
    ("interestExpense", "Interest expense", "income", "flow", ["InterestExpense", "InterestExpenseNonoperating", "InterestExpenseDebt"]),
    ("pretaxIncome", "Income before taxes", "income", "flow", ["IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest", "IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments", "IncomeLossFromContinuingOperationsBeforeIncomeTaxesDomestic"]),
    ("incomeTax", "Income tax", "income", "flow", ["IncomeTaxExpenseBenefit"]),
    ("netIncome", "Net income", "income", "flow", ["NetIncomeLoss", "ProfitLoss", "NetIncomeLossAvailableToCommonStockholdersBasic"]),
    ("epsDiluted", "Diluted EPS", "income", "per_share", ["EarningsPerShareDiluted", "EarningsPerShareBasicAndDiluted"]),
    ("sharesDiluted", "Diluted shares", "income", "shares", ["WeightedAverageNumberOfDilutedSharesOutstanding", "WeightedAverageNumberOfShareOutstandingBasicAndDiluted"]),
    ("da", "Depreciation and amortization", "cash", "flow", ["DepreciationDepletionAndAmortization", "DepreciationAmortizationAndAccretionNet", "DepreciationAndAmortization", "Depreciation"]),
    ("cash", "Cash and equivalents", "balance", "instant", ["CashAndCashEquivalentsAtCarryingValue", "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents", "Cash"]),
    ("shortTermInvestments", "Short-term investments", "balance", "instant", ["ShortTermInvestments", "MarketableSecuritiesCurrent", "AvailableForSaleSecuritiesDebtSecuritiesCurrent"]),
    ("receivables", "Accounts receivable", "balance", "instant", ["AccountsReceivableNetCurrent", "ReceivablesNetCurrent"]),
    ("inventory", "Inventory", "balance", "instant", ["InventoryNet"]),
    ("currentAssets", "Total current assets", "balance", "instant", ["AssetsCurrent"]),
    ("ppe", "Property and equipment, net", "balance", "instant", ["PropertyPlantAndEquipmentNet", "PropertyPlantAndEquipmentAndFinanceLeaseRightOfUseAssetAfterAccumulatedDepreciationAndAmortization"]),
    ("goodwill", "Goodwill", "balance", "instant", ["Goodwill"]),
    ("intangibles", "Intangible assets", "balance", "instant", ["IntangibleAssetsNetExcludingGoodwill", "FiniteLivedIntangibleAssetsNet"]),
    ("totalAssets", "Total assets", "balance", "instant", ["Assets"]),
    ("currentLiabilities", "Total current liabilities", "balance", "instant", ["LiabilitiesCurrent"]),
    ("shortTermDebt", "Short-term debt", "balance", "instant", ["DebtCurrent", "LongTermDebtCurrent", "ShortTermBorrowings", "CommercialPaper"]),
    ("longTermDebt", "Long-term debt", "balance", "instant", ["LongTermDebtNoncurrent", "LongTermDebt", "LongTermDebtAndCapitalLeaseObligations"]),
    ("totalLiabilities", "Total liabilities", "balance", "instant", ["Liabilities"]),
    ("equity", "Shareholders' equity", "balance", "instant", ["StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"]),
    ("liabilitiesAndEquity", "Total liabilities and equity", "balance", "instant", ["LiabilitiesAndStockholdersEquity"]),
    ("cfo", "Cash from operations", "cash", "flow", ["NetCashProvidedByUsedInOperatingActivities", "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations"]),
    ("capex", "Capital expenditures", "cash", "flow", ["PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets", "PaymentsForCapitalImprovements"]),
    ("cfi", "Cash from investing", "cash", "flow", ["NetCashProvidedByUsedInInvestingActivities", "NetCashProvidedByUsedInInvestingActivitiesContinuingOperations"]),
    ("cff", "Cash from financing", "cash", "flow", ["NetCashProvidedByUsedInFinancingActivities", "NetCashProvidedByUsedInFinancingActivitiesContinuingOperations"]),
    ("dividends", "Dividends paid", "cash", "flow", ["PaymentsOfDividends", "PaymentsOfDividendsCommonStock"]),
    ("buybacks", "Share repurchases", "cash", "flow", ["PaymentsForRepurchaseOfCommonStock"]),
    ("sbc", "Stock-based compensation", "cash", "flow", ["ShareBasedCompensation", "AllocatedShareBasedCompensationExpense"]),
]
UNIT = {"flow": "USD", "instant": "USD", "per_share": "USD/shares", "shares": "shares"}
ANNUAL_FORMS = {"10-K", "10-K/A", "10-KT", "20-F", "40-F"}


def _days(s: str, e: str) -> int:
    return (date.fromisoformat(e) - date.fromisoformat(s)).days


def _series(facts: dict, concept: str, kind: str) -> tuple[dict, dict]:
    """(annual, quarterly) values for one concept: {end: (value, start, filed, accession)}."""
    node = facts.get("us-gaap", {}).get(concept) or facts.get("ifrs-full", {}).get(concept)
    if not node:
        return {}, {}
    rows = node.get("units", {}).get(UNIT[kind], [])
    annual, quarterly = {}, {}
    for f in rows:
        end, start, filed = f["end"], f.get("start"), f.get("filed", "")
        if kind == "instant":
            if start:
                continue
            bucket = annual if f.get("form") in ANNUAL_FORMS and f.get("fp") == "FY" else quarterly
            for b in (bucket, quarterly) if bucket is annual else (bucket,):
                cur = b.get(end)
                if cur is None or filed > cur[2]:
                    b[end] = (f["val"], None, filed, f.get("accn"))
            continue
        if not start:
            continue
        d = _days(start, end)
        if 350 <= d <= 380 and f.get("form") in ANNUAL_FORMS:
            target = annual
        elif 80 <= d <= 100:
            target = quarterly
        else:
            continue
        cur = target.get(end)
        if cur is None or filed > cur[2]:  # later filings restate earlier ones
            target[end] = (f["val"], start, filed, f.get("accn"))
    if kind in ("per_share", "shares"):
        splits = _splits(rows, kind)
        if splits:
            for target in (annual, quarterly):
                for end, (v, s, filed, accn) in list(target.items()):
                    factor = 1.0
                    for when, ratio in splits:
                        if filed < when:
                            factor *= ratio
                    if factor != 1.0:
                        target[end] = (v / factor if kind == "per_share" else v * factor, s, filed, accn)
    return annual, quarterly


SPLIT_RATIOS = (1.5, 2, 3, 4, 5, 6, 8, 10, 15, 20, 25, 30, 40, 50)


def _splits(rows: list[dict], kind: str) -> list[tuple[str, float]]:
    """Stock splits, found where a later filing restates a period's per-share figure by a split ratio.

    Companies restate per-share history after a split, but periods that only appear in
    filings from before the split keep the old basis. Returns (first filing on the new
    basis, ratio) so older values can be put on today's basis.
    """
    by_period: dict[tuple, list[tuple[str, float]]] = {}
    for f in rows:
        if f.get("val"):
            by_period.setdefault((f.get("start"), f["end"]), []).append((f.get("filed", ""), float(f["val"])))
    events = []
    for reports in by_period.values():
        reports.sort()
        for (f1, v1), (f2, v2) in zip(reports, reports[1:]):
            if f1 == f2 or not v1 or not v2 or (v1 > 0) != (v2 > 0):
                continue
            r = v1 / v2 if kind == "per_share" else v2 / v1
            if r > 1.2:
                events.append((f2, f1, r))
    # Walk restatements in date order. A ratio already explained by splits found between the two
    # filings is not a new split (a period reported before and after two splits shows their product).
    out: list[tuple[str, float]] = []
    for f2, f1, r in sorted(events):
        known = 1.0
        for when, ratio in out:
            if f1 < when <= f2:
                known *= ratio
        rest = r / known
        if abs(rest - 1) < 0.03:
            continue
        ratio = next((x for x in SPLIT_RATIOS if abs(rest / x - 1) < 0.03), None)
        if ratio and not any(abs((date.fromisoformat(f2) - date.fromisoformat(w)).days) < 400 and x == ratio for w, x in out):
            out.append((f2, ratio))
    return sorted(out)


def _add_days(d: str, n: int) -> str:
    from datetime import timedelta

    return (date.fromisoformat(d) + timedelta(days=n)).isoformat()


def _fiscal_label(end: str, fye: str | None, quarterly: bool) -> str:
    y, m = int(end[:4]), int(end[5:7])
    fm = int(fye[:2]) if fye and fye[:2].isdigit() else 12
    # Fiscal years ending in the first days of a month (52/53-week years) belong to the prior month.
    if int(end[8:10]) <= 7 and not quarterly:
        m = 12 if m == 1 else m - 1
    if not quarterly:
        return f"FY{y}"
    qm = m if int(end[8:10]) > 7 else (12 if m == 1 else m - 1)
    ahead = (fm - qm) % 12
    q = 4 - round(ahead / 3)
    fy = y + (1 if qm > fm else 0)
    return f"Q{q} FY{str(fy)[2:]}" if 1 <= q <= 4 else end


@memoize("fin:v4", 6 * HOUR)
async def statements(cik: int) -> dict:
    cf = await sec.get_json(f"https://data.sec.gov/api/xbrl/companyfacts/CIK{sec.cik10(cik)}.json", 6 * HOUR)
    facts = cf.get("facts", {})
    sub = await submissions(cik)
    fye = sub.get("fiscalYearEnd")

    raw = {}
    for key, label, stmt, kind, cands in LINES:
        a_all, q_all = {}, {}
        for c in cands:
            a, q = _series(facts, c, kind)
            for end, v in a.items():
                a_all.setdefault(end, (*v, c))
            for end, v in q.items():
                q_all.setdefault(end, (*v, c))
        raw[key] = (a_all, q_all)

    # Annual periods: fiscal year ends that carry revenue or net income.
    a_ends = sorted(set(raw["revenue"][0]) | set(raw["netIncome"][0]))[-10:]
    q_flow_ends = sorted(set(raw["revenue"][1]) | set(raw["netIncome"][1]))

    def annual_value(key, end):
        kind = next(l[3] for l in LINES if l[0] == key)
        a, q = raw[key]
        hit = a.get(end) or (q.get(end) if kind == "instant" else None)
        return (hit[0], hit[4]) if hit else (None, None)

    # Quarterly periods: the last 12 quarter ends, including derived fourth quarters.
    ends = sorted(set(q_flow_ends) | set(a_ends))
    q_ends = [e for e in ends if e in q_flow_ends or e in a_ends][-12:]

    def quarter_value(key, end):
        kind = next(l[3] for l in LINES if l[0] == key)
        a, q = raw[key]
        if end in q:
            return q[end][0], q[end][4]
        if kind in ("instant",):
            return (a[end][0], a[end][4]) if end in a else (None, None)
        if kind in ("flow",) and end in a:
            fy_val, fy_start = a[end][0], a[end][1]
            inside = [v for e, v in q.items() if fy_start < e < end and v[1] and v[1] >= fy_start]
            if len(inside) == 3:
                return fy_val - sum(v[0] for v in inside), a[end][4] + " (FY less Q1-Q3)"
        if kind == "per_share" and end in a:
            return None, None
        return None, None

    def build(ends_, getter, quarterly):
        lines = {}
        sources = {}
        for key, *_ in LINES:
            vals, srcs = [], []
            for e in ends_:
                v, s = getter(key, e)
                vals.append(v)
                srcs.append(s)
            lines[key] = vals
            sources[key] = sorted({s for s in srcs if s})
        n = len(ends_)
        # Derived lines.
        def get(k, i):
            return lines[k][i]
        lines["grossProfit"] = [get("grossProfit", i) if get("grossProfit", i) is not None else (get("revenue", i) - get("costOfRevenue", i) if get("revenue", i) is not None and get("costOfRevenue", i) is not None else None) for i in range(n)]
        lines["ebitda"] = [get("operatingIncome", i) + get("da", i) if get("operatingIncome", i) is not None and get("da", i) is not None else None for i in range(n)]
        lines["fcf"] = [get("cfo", i) - get("capex", i) if get("cfo", i) is not None and get("capex", i) is not None else None for i in range(n)]
        lines["totalDebt"] = [(get("shortTermDebt", i) or 0) + (get("longTermDebt", i) or 0) if get("longTermDebt", i) is not None or get("shortTermDebt", i) is not None else None for i in range(n)]
        lines["netDebt"] = [lines["totalDebt"][i] - (get("cash", i) or 0) - (get("shortTermInvestments", i) or 0) if lines["totalDebt"][i] is not None else None for i in range(n)]
        lines["totalLiabilities"] = [get("totalLiabilities", i) if get("totalLiabilities", i) is not None else (get("liabilitiesAndEquity", i) - get("equity", i) if get("liabilitiesAndEquity", i) is not None and get("equity", i) is not None else None) for i in range(n)]
        sources["ebitda"] = ["Operating income + depreciation and amortization"]
        sources["fcf"] = ["Cash from operations − capital expenditures"]
        sources["totalDebt"] = ["Short-term debt + long-term debt"]
        sources["netDebt"] = ["Total debt − cash − short-term investments"]
        periods = [{"end": e, "label": _fiscal_label(e, fye, quarterly)} for e in ends_]
        return {"periods": periods, "lines": lines, "sources": sources}

    return {
        "fiscalYearEnd": fye,
        "annual": build(a_ends, annual_value, False),
        "quarterly": build(q_ends, quarter_value, True),
        "entity": cf.get("entityName"),
    }


LAYOUT = {
    "income": [("revenue", "Revenue", 0), ("costOfRevenue", "Cost of revenue", 1), ("grossProfit", "Gross profit", 0), ("rnd", "Research and development", 1),
               ("sga", "Selling, general and administrative", 1), ("operatingIncome", "Operating income", 0), ("da", "Depreciation and amortization", 1),
               ("ebitda", "EBITDA", 0), ("interestExpense", "Interest expense", 1), ("pretaxIncome", "Income before taxes", 0), ("incomeTax", "Income tax", 1),
               ("netIncome", "Net income", 0), ("epsDiluted", "Diluted EPS", 0), ("sharesDiluted", "Diluted shares", 1)],
    "balance": [("cash", "Cash and equivalents", 1), ("shortTermInvestments", "Short-term investments", 1), ("receivables", "Accounts receivable", 1),
                ("inventory", "Inventory", 1), ("currentAssets", "Total current assets", 0), ("ppe", "Property and equipment, net", 1), ("goodwill", "Goodwill", 1),
                ("intangibles", "Intangible assets", 1), ("totalAssets", "Total assets", 0), ("currentLiabilities", "Total current liabilities", 0),
                ("shortTermDebt", "Short-term debt", 1), ("longTermDebt", "Long-term debt", 1), ("totalDebt", "Total debt", 0), ("netDebt", "Net debt", 1),
                ("totalLiabilities", "Total liabilities", 0), ("equity", "Shareholders' equity", 0)],
    "cash": [("cfo", "Cash from operations", 0), ("sbc", "Stock-based compensation", 1), ("capex", "Capital expenditures", 1), ("fcf", "Free cash flow", 0),
             ("cfi", "Cash from investing", 0), ("dividends", "Dividends paid", 1), ("buybacks", "Share repurchases", 1), ("cff", "Cash from financing", 0)],
}
