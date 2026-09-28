"""Institutional ownership from the 13F database built by scripts/build_13f.py."""
from __future__ import annotations

import os
import re
import sqlite3

from .companies import norm_name, submissions

PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "13f.db")


def _db() -> sqlite3.Connection | None:
    if not os.path.exists(PATH):
        return None
    return sqlite3.connect(f"file:{PATH}?mode=ro", uri=True)


def _norm(name: str) -> str:
    return norm_name(re.sub(r"\b(DEL|NEW|COM|CL [A-Z]|/[A-Z]{2}/)\b", " ", name, flags=re.I))


async def holders(cik: int) -> dict:
    db = _db()
    if db is None:
        return {"available": False, "reason": "The 13F database has not been built. Run scripts/build_13f.py."}
    s = await submissions(cik)
    names = [s.get("name", "")] + [f.get("name", "") for f in s.get("formerNames", [])[:1]]
    cusips = []
    for n in names:
        key = _norm(n)
        cusips = db.execute("SELECT cusip, name, class FROM issuers WHERE norm = ?", (key,)).fetchall()
        if cusips:
            break
    # Drop depositary shares, warrants and notes that share the issuer name.
    cusips = [c for c in cusips if not re.search(r"\b(DEP|WT|WARR|NOTE|PFD|PREF|RT)\b", c[2] or "", re.I)]
    managers = {r[0]: {"cik": r[0], "name": r[1], "period": r[2], "prior": r[3], "filed": r[4], "accession": r[5], "total": r[6]}
                for r in db.execute("SELECT cik, name, period, prior, filed, accession, total, positions FROM managers")}
    base = {"available": True, "managers": len(managers), "periods": sorted({m["period"] for m in managers.values()}, reverse=True)}
    if not cusips:
        return {**base, "classes": [], "holders": [], "reason": "No position in this company among the tracked managers, or its name could not be matched to 13F issuer names."}

    marks = ",".join("?" * len(cusips))
    rows = db.execute(f"SELECT cik, q, SUM(value), SUM(shares) FROM holdings WHERE cusip IN ({marks}) GROUP BY cik, q", [c[0] for c in cusips]).fetchall()
    by: dict[int, dict] = {}
    for mcik, q, value, shares in rows:
        h = by.setdefault(mcik, {"value": 0, "shares": 0, "priorShares": 0, "priorValue": 0})
        if q == 0:
            h["value"], h["shares"] = value, shares
        else:
            h["priorValue"], h["priorShares"] = value, shares
    out = []
    for mcik, h in by.items():
        m = managers[mcik]
        change = h["shares"] - h["priorShares"] if m["prior"] else None
        if change is None:
            status = "noprior"
        else:
            status = ("new" if not h["priorShares"] else "exited" if not h["shares"] else "increased" if change > 0.005 * h["priorShares"]
                      else "reduced" if change < -0.005 * h["priorShares"] else "unchanged")
        out.append({
            "cik": mcik, "name": m["name"], "period": m["period"], "prior": m["prior"], "accession": m["accession"],
            "shares": h["shares"], "value": h["value"], "priorShares": h["priorShares"], "change": change,
            "changePct": change / h["priorShares"] if change is not None and h["priorShares"] else None, "status": status,
            "weight": h["value"] / m["total"] if m["total"] else None,
        })
    out.sort(key=lambda r: -r["value"])
    held = [r for r in out if r["shares"]]
    return {
        **base, "classes": [{"cusip": c[0], "issuer": c[1], "class": c[2]} for c in cusips], "holders": out,
        "summary": {
            "holders": len(held), "shares": sum(r["shares"] for r in held), "value": sum(r["value"] for r in held),
            "netChange": sum(r["change"] for r in out if r["change"] is not None),
            **{k: sum(1 for r in out if r["status"] == k) for k in ("new", "increased", "reduced", "exited", "unchanged")},
        },
    }
