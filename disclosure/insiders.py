"""Insider transactions from Form 4 filings."""
from __future__ import annotations

import asyncio

from lxml import etree

from . import sec
from .companies import submissions
from .sec import DAY, HOUR
from .store import memoize

CODES = {
    "P": "Open-market purchase", "S": "Open-market sale", "A": "Grant or award", "M": "Option exercise", "F": "Tax withholding",
    "G": "Gift", "C": "Conversion", "D": "Disposition to the company", "X": "Option exercise", "J": "Other", "W": "Inheritance",
}


def _t(el, path: str) -> str | None:
    x = el.find(path)
    return x.text.strip() if x is not None and x.text else None


def _num(el, path: str) -> float | None:
    v = _t(el, path)
    try:
        return float(v) if v is not None else None
    except ValueError:
        return None


def parse(xml: bytes, meta: dict) -> list[dict]:
    root = etree.fromstring(xml, etree.XMLParser(recover=True))
    owners = []
    for o in root.findall("reportingOwner"):
        rel = o.find("reportingOwnerRelationship")
        role = []
        if rel is not None:
            if _t(rel, "isDirector") in ("1", "true"):
                role.append("Director")
            if _t(rel, "isOfficer") in ("1", "true"):
                role.append(_t(rel, "officerTitle") or "Officer")
            if _t(rel, "isTenPercentOwner") in ("1", "true"):
                role.append("10% owner")
        owners.append({"name": _t(o, "reportingOwnerId/rptOwnerName") or "Unknown", "cik": _t(o, "reportingOwnerId/rptOwnerCik"), "role": ", ".join(role)})
    owner = owners[0] if owners else {"name": "Unknown", "cik": None, "role": ""}
    plan = _t(root, "aff10b5One") in ("1", "true")
    out = []
    for kind, path in (("common", "nonDerivativeTable/nonDerivativeTransaction"), ("derivative", "derivativeTable/derivativeTransaction")):
        for t in root.findall(path):
            code = _t(t, "transactionCoding/transactionCode") or ""
            shares = _num(t, "transactionAmounts/transactionShares/value")
            price = _num(t, "transactionAmounts/transactionPricePerShare/value")
            out.append({
                **meta, "owner": owner["name"], "ownerCik": owner["cik"], "role": owner["role"], "kind": kind,
                "security": _t(t, "securityTitle/value"), "date": _t(t, "transactionDate/value") or meta["filed"],
                "code": code, "type": CODES.get(code, code),
                "acquired": _t(t, "transactionAmounts/transactionAcquiredDisposedCode/value") == "A",
                "shares": shares, "price": price if price and price > 0 else None,
                "value": shares * price if shares and price and price > 0 else None,
                "after": _num(t, "postTransactionAmounts/sharesOwnedFollowingTransaction/value"),
                "direct": _t(t, "ownershipNature/directOrIndirectOwnership/value") != "I",
                "plan": plan,
            })
    return out


@memoize("insiders:v2", 6 * HOUR)
async def transactions(cik: int, limit: int = 40) -> dict:
    rec = (await submissions(cik))["filings"]["recent"]
    idx = [i for i, f in enumerate(rec["form"]) if f in ("4", "4/A")][:limit]

    async def one(i):
        acc = rec["accessionNumber"][i]
        name = str(rec["primaryDocument"][i]).split("/")[-1]  # strip the xsl rendering prefix to get raw XML
        try:
            xml = await sec.get(sec.archive_url(cik, acc, name), DAY * 30)
        except (sec.NotFound, sec.Upstream):
            return []
        return parse(xml, {"accession": acc, "filed": rec["filingDate"][i]})

    rows = [r for group in await asyncio.gather(*(one(i) for i in idx)) for r in group]
    rows.sort(key=lambda r: (r["date"], r["filed"]), reverse=True)

    months: dict[str, dict] = {}
    for r in rows:
        if r["kind"] != "common" or r["code"] not in ("P", "S") or not r["value"]:
            continue
        m = months.setdefault(r["date"][:7], {"month": r["date"][:7], "buys": 0.0, "sells": 0.0, "buyCount": 0, "sellCount": 0})
        if r["code"] == "P":
            m["buys"] += r["value"]
            m["buyCount"] += 1
        else:
            m["sells"] += r["value"]
            m["sellCount"] += 1

    people: dict[str, dict] = {}
    for r in rows:
        p = people.setdefault(r["owner"], {"owner": r["owner"], "role": r["role"], "bought": 0.0, "sold": 0.0, "boughtShares": 0.0, "soldShares": 0.0,
                                           "last": r["date"], "holding": None, "plan": 0, "trades": 0})
        if r["kind"] == "common":
            if p["holding"] is None and r["after"] is not None and r["direct"]:
                p["holding"] = r["after"]
            if r["code"] == "P" and r["value"]:
                p["bought"] += r["value"]
                p["boughtShares"] += r["shares"] or 0
            if r["code"] == "S" and r["value"]:
                p["sold"] += r["value"]
                p["soldShares"] += r["shares"] or 0
                p["plan"] += 1 if r["plan"] else 0
        p["trades"] += 1
    span = (rows[-1]["date"], rows[0]["date"]) if rows else (None, None)
    return {
        "filings": len(idx), "span": span, "transactions": rows,
        "months": sorted(months.values(), key=lambda m: m["month"]),
        "insiders": sorted(people.values(), key=lambda p: -(p["bought"] + p["sold"])),
    }
