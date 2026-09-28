"""The filing library: every filing a company has made, with plain-English form names."""
from __future__ import annotations

from . import sec
from .companies import submissions
from .sec import DAY

FORM_NAMES = {
    "10-K": "Annual report", "10-K/A": "Annual report (amended)", "10-KT": "Transition report",
    "10-Q": "Quarterly report", "10-Q/A": "Quarterly report (amended)",
    "8-K": "Current report", "8-K/A": "Current report (amended)",
    "20-F": "Annual report, foreign issuer", "40-F": "Annual report, Canadian issuer", "6-K": "Current report, foreign issuer",
    "DEF 14A": "Proxy statement", "DEFA14A": "Additional proxy materials", "PRE 14A": "Preliminary proxy statement",
    "DEFM14A": "Merger proxy statement", "S-1": "Registration statement", "S-1/A": "Registration statement (amended)",
    "S-3": "Shelf registration", "S-3ASR": "Automatic shelf registration", "S-4": "Registration for a business combination",
    "S-8": "Employee plan registration", "424B2": "Prospectus", "424B3": "Prospectus", "424B5": "Prospectus supplement",
    "FWP": "Free writing prospectus", "4": "Statement of changes in beneficial ownership", "4/A": "Form 4 (amended)",
    "3": "Initial statement of beneficial ownership", "5": "Annual statement of beneficial ownership",
    "144": "Notice of proposed sale", "13F-HR": "Institutional holdings report", "13F-NT": "Institutional holdings notice",
    "SC 13G": "Beneficial ownership over 5% (passive)", "SC 13G/A": "Beneficial ownership (amended)",
    "SC 13D": "Beneficial ownership over 5% (active)", "SC 13D/A": "Beneficial ownership (amended)",
    "SCHEDULE 13G": "Beneficial ownership over 5% (passive)", "SCHEDULE 13G/A": "Beneficial ownership (amended)",
    "SCHEDULE 13D": "Beneficial ownership over 5% (active)", "SCHEDULE 13D/A": "Beneficial ownership (amended)",
    "11-K": "Employee plan annual report", "SD": "Specialized disclosure (conflict minerals)", "CORRESP": "Correspondence with SEC staff",
    "UPLOAD": "SEC staff comment letter", "25-NSE": "Notice of delisting", "NT 10-K": "Late filing notice", "NT 10-Q": "Late filing notice",
    "ARS": "Annual report to shareholders", "IRANNOTICE": "Iran activity notice",
}

# 8-K item codes, for the library and the timeline.
ITEMS_8K = {
    "1.01": "Material agreement", "1.02": "Agreement terminated", "1.03": "Bankruptcy", "1.05": "Cybersecurity incident",
    "2.01": "Acquisition or disposition completed", "2.02": "Results of operations", "2.03": "New financial obligation",
    "2.04": "Obligation accelerated", "2.05": "Exit or restructuring costs", "2.06": "Material impairment",
    "3.01": "Listing notice", "3.02": "Unregistered equity sale", "3.03": "Change to shareholder rights",
    "4.01": "Auditor change", "4.02": "Prior financials no longer reliable", "5.01": "Change in control",
    "5.02": "Officer or director change", "5.03": "Bylaws or fiscal year change", "5.05": "Code of ethics change",
    "5.07": "Shareholder vote results", "5.08": "Director nominations", "7.01": "Regulation FD disclosure",
    "8.01": "Other events", "9.01": "Financial statements and exhibits",
}

FIELDS = ("accessionNumber", "filingDate", "reportDate", "acceptanceDateTime", "form", "items", "size",
          "isXBRL", "isInlineXBRL", "primaryDocument", "primaryDocDescription")


def _rows(block: dict, cik: int) -> list[dict]:
    n = len(block.get("form", []))
    out = []
    for i in range(n):
        f = {k: (block.get(k) or [None] * n)[i] for k in FIELDS}
        form = f["form"] or ""
        items = [x for x in (f["items"] or "").split(",") if x]
        out.append({
            "accession": f["accessionNumber"],
            "form": form,
            "filed": f["filingDate"],
            "period": f["reportDate"] or None,
            "accepted": f["acceptanceDateTime"],
            "name": FORM_NAMES.get(form, f["primaryDocDescription"] or form),
            "description": f["primaryDocDescription"] or "",
            "items": [{"code": c, "label": ITEMS_8K.get(c, c)} for c in items],
            "status": "Amendment" if form.endswith("/A") else "Original",
            "doc": f["primaryDocument"],
            "size": f["size"],
            "xbrl": bool(f["isInlineXBRL"] or f["isXBRL"]),
            "index": sec.archive_url(cik, f["accessionNumber"], f"{f['accessionNumber']}-index.htm"),
        })
    return out


async def library(cik: int, full: bool = False) -> dict:
    """Recent filings (about the last 1,000), or the company's complete history."""
    s = await submissions(cik)
    rows = _rows(s["filings"]["recent"], cik)
    older = s["filings"].get("files", [])
    if full:
        for f in older:
            j = await sec.get_json(f"https://data.sec.gov/submissions/{f['name']}", DAY)
            rows += _rows(j, cik)
    return {"filings": rows, "complete": full or not older, "olderCount": sum(f.get("filingCount", 0) for f in older)}


async def find(cik: int, accession: str) -> dict:
    """One filing's library row, searching older pages only if needed."""
    lib = await library(cik)
    hit = next((f for f in lib["filings"] if f["accession"] == accession), None)
    if hit is None and not lib["complete"]:
        hit = next((f for f in (await library(cik, True))["filings"] if f["accession"] == accession), None)
    if hit is None:
        raise sec.NotFound(f"Filing {accession} not found for CIK {cik}")
    return hit
