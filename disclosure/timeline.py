"""Company timeline: filings grouped into the events an analyst tracks."""
from __future__ import annotations

from . import filings

# (category, label) by form; 8-Ks are classified by item.
FORMS = {
    "10-K": ("reports", "Annual report"), "10-K/A": ("reports", "Annual report amended"), "20-F": ("reports", "Annual report"),
    "40-F": ("reports", "Annual report"), "10-Q": ("reports", "Quarterly report"), "10-Q/A": ("reports", "Quarterly report amended"),
    "S-1": ("capital", "IPO or share registration"), "S-3": ("capital", "Shelf registration"), "S-3ASR": ("capital", "Automatic shelf registration"),
    "424B2": ("capital", "Securities offering"), "424B5": ("capital", "Securities offering"), "424B3": ("capital", "Prospectus"),
    "S-8": ("capital", "Employee share plan registration"), "S-4": ("deals", "Merger or exchange registration"), "S-4/A": ("deals", "Merger registration amended"),
    "DEFM14A": ("deals", "Merger proxy"), "SC TO-T": ("deals", "Tender offer"), "SC TO-I": ("capital", "Issuer tender offer"), "SC 14D9": ("deals", "Tender offer response"),
    "DEF 14A": ("governance", "Proxy statement"), "SC 13D": ("ownership", "Activist or control stake over 5%"), "SC 13D/A": ("ownership", "Activist stake amended"),
    "SCHEDULE 13D": ("ownership", "Activist or control stake over 5%"), "SCHEDULE 13D/A": ("ownership", "Activist stake amended"),
    "SC 13G": ("ownership", "Passive stake over 5%"), "SCHEDULE 13G": ("ownership", "Passive stake over 5%"),
    "25-NSE": ("capital", "Delisting of a security"), "NT 10-K": ("governance", "Late annual report notice"), "NT 10-Q": ("governance", "Late quarterly report notice"),
}
ITEMS = {
    "2.02": ("results", "Earnings release"), "1.01": ("deals", "Material agreement"), "1.02": ("deals", "Agreement terminated"),
    "2.01": ("deals", "Acquisition or disposition completed"), "2.03": ("capital", "New debt or obligation"), "3.02": ("capital", "Unregistered share sale"),
    "3.03": ("capital", "Change to shareholder rights"), "5.02": ("leadership", "Officer or director change"), "5.03": ("governance", "Bylaw or fiscal year change"),
    "5.07": ("governance", "Shareholder vote results"), "2.05": ("restructuring", "Restructuring or exit costs"), "2.06": ("restructuring", "Material impairment"),
    "4.01": ("governance", "Auditor change"), "4.02": ("governance", "Restatement: prior financials unreliable"), "1.05": ("governance", "Cybersecurity incident"),
    "1.03": ("restructuring", "Bankruptcy or receivership"), "5.01": ("deals", "Change in control"), "3.01": ("capital", "Listing standard notice"),
}
CATEGORIES = [
    ("reports", "Annual and quarterly reports"), ("results", "Earnings"), ("deals", "Acquisitions and agreements"), ("capital", "Securities and debt"),
    ("leadership", "Leadership"), ("governance", "Governance and votes"), ("restructuring", "Restructuring and impairment"),
    ("ownership", "Large shareholders"), ("insiders", "Insider filings"),
]


async def events(cik: int, full: bool = False) -> dict:
    lib = await filings.library(cik, full)
    out = []
    insider_months: dict[str, int] = {}
    insider_last: dict[str, str] = {}
    for f in lib["filings"]:
        form = f["form"]
        if form in ("3", "4", "5", "4/A", "144"):
            insider_months[f["filed"][:7]] = insider_months.get(f["filed"][:7], 0) + 1
            insider_last[f["filed"][:7]] = max(insider_last.get(f["filed"][:7], ""), f["filed"])
            continue
        if form in ("8-K", "8-K/A", "6-K"):
            items = [i["code"] for i in f["items"] if i["code"] in ITEMS]
            if not items:
                continue
            main = items[0]
            cat, label = ITEMS[main]
            out.append({"date": f["filed"], "category": cat, "label": label, "form": form, "accession": f["accession"],
                        "detail": [ITEMS[c][1] for c in items[1:]]})
        elif form in FORMS:
            cat, label = FORMS[form]
            out.append({"date": f["filed"], "category": cat, "label": label, "form": form, "accession": f["accession"],
                        "period": f["period"], "detail": []})
    for month, n in insider_months.items():
        out.append({"date": insider_last[month], "category": "insiders", "label": f"{n} insider filing{'s' if n > 1 else ''} (Forms 3, 4, 5, 144)", "form": "4", "month": month, "detail": []})
    out.sort(key=lambda e: e["date"], reverse=True)
    counts = {c: sum(1 for e in out if e["category"] == c) for c, _ in CATEGORIES}
    return {"events": out, "categories": [{"key": k, "label": l, "count": counts[k]} for k, l in CATEGORIES], "complete": lib["complete"]}
