"""Company lookup: ticker, name or accession number to a CIK, and the company profile."""
from __future__ import annotations

import re

from . import sec
from .sec import DAY, HOUR, NotFound

ACCESSION = re.compile(r"^\s*(\d{10})-?(\d{2})-?(\d{6})\s*$")
_SUFFIX = re.compile(r"\b(inc|incorporated|corp|corporation|co|company|ltd|limited|plc|holdings?|group|the|sa|nv|ag|lp|llc)\b\.?", re.I)


def norm_ticker(q: str) -> str:
    return q.strip().upper().lstrip("$").replace(".", "-").replace("/", "-")


def norm_name(s: str) -> str:
    s = re.sub(r"[^a-z0-9 ]", " ", s.lower().replace("&", " and "))
    return re.sub(r"\s+", " ", _SUFFIX.sub(" ", s)).strip()


async def index() -> list[dict]:
    """Every company with a ticker, from the SEC's ticker/exchange file."""
    j = await sec.get_json("https://www.sec.gov/files/company_tickers_exchange.json", DAY)
    return [dict(zip(("cik", "name", "ticker", "exchange"), row)) for row in j["data"]]


async def search(q: str, limit: int = 10) -> list[dict]:
    """Rank tickers and names against a query. Exact ticker first, then name prefixes, then substrings."""
    q = q.strip()
    if not q:
        return []
    if ACCESSION.match(q):
        hit = await by_accession(q)
        return [hit] if hit else []
    rows = await index()
    t, n = norm_ticker(q), norm_name(q)
    scored = []
    for r in rows:
        tk, name = r["ticker"] or "", norm_name(r["name"] or "")
        if tk == t:
            s = 0
        elif n and name == n:
            s = 1
        elif n and name.startswith(n):
            s = 2
        elif tk.startswith(t):
            s = 3
        elif n and len(n) > 2 and f" {n}" in f" {name}":
            s = 4
        else:
            continue
        scored.append((s, len(name), r))
    scored.sort(key=lambda x: (x[0], x[1]))
    out, seen = [], set()
    for _, _, r in scored:
        if r["cik"] in seen:  # one row per company, even with several share classes
            continue
        seen.add(r["cik"])
        out.append({**r, "kind": "company"})
        if len(out) >= limit:
            break
    return out


async def by_accession(q: str) -> dict | None:
    """Find the company behind an accession number through EDGAR full-text search."""
    m = ACCESSION.match(q)
    acc = f"{m[1]}-{m[2]}-{m[3]}"
    j = await sec.get_json(f'https://efts.sec.gov/LATEST/search-index?q=%22{acc}%22', DAY)
    for h in j.get("hits", {}).get("hits", []):
        if h["_id"].startswith(acc) and h["_source"].get("ciks"):
            cik = int(h["_source"]["ciks"][0])
            name = re.sub(r"\s+\(.*$", "", h["_source"]["display_names"][0])
            tk = next((r["ticker"] for r in await index() if r["cik"] == cik), None)
            return {"cik": cik, "name": name, "ticker": tk, "exchange": None, "kind": "filing", "accession": acc}
    return None


async def resolve(key: str) -> int:
    """A ticker or CIK from a URL to a CIK."""
    if key.isdigit():
        return int(key)
    t = norm_ticker(key)
    for r in await index():
        if r["ticker"] == t:
            return int(r["cik"])
    raise NotFound(f"{key} is not in the SEC ticker list")


async def submissions(cik: int) -> dict:
    return await sec.get_json(f"https://data.sec.gov/submissions/CIK{sec.cik10(cik)}.json", HOUR)


async def profile(cik: int) -> dict:
    s = await submissions(cik)
    rec = s["filings"]["recent"]
    forms = rec.get("form", [])
    last = next((i for i, f in enumerate(forms) if f in ("10-K", "10-Q", "20-F", "40-F")), None)
    addr = s.get("addresses", {}).get("business", {}) or {}
    return {
        "cik": int(s["cik"]),
        "name": s.get("name"),
        "tickers": s.get("tickers", []),
        "exchanges": s.get("exchanges", []),
        "sic": s.get("sic"),
        "sicDescription": s.get("sicDescription"),
        "category": s.get("category"),
        "entityType": s.get("entityType"),
        "fiscalYearEnd": s.get("fiscalYearEnd"),
        "stateOfIncorporation": s.get("stateOfIncorporationDescription") or s.get("stateOfIncorporation"),
        "ein": s.get("ein"),
        "phone": s.get("phone"),
        "address": ", ".join(x for x in (addr.get("street1"), addr.get("city"), addr.get("stateOrCountry")) if x),
        "formerNames": [f.get("name") for f in s.get("formerNames", [])],
        "latestFiling": {"form": forms[0], "date": rec["filingDate"][0]} if forms else None,
        "latestReport": {"form": forms[last], "date": rec["filingDate"][last], "period": rec["reportDate"][last]} if last is not None else None,
        "filingCount": len(forms) + sum(f.get("filingCount", 0) for f in s["filings"].get("files", [])),
    }
