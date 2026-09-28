"""Build data/13f.db: the last two 13F-HR holdings of the largest institutional managers.

A company's institutional holders can't be looked up directly on EDGAR: a
13F lists what a manager owns, not who owns a company. Answering "who holds
Microsoft" means reading every manager's filing, so this script does that
ahead of time for a fixed list of the largest managers and stores their
equity positions by CUSIP. Run it after each quarterly 13F deadline:

    python scripts/build_13f.py
"""
from __future__ import annotations

import asyncio
import os
import re
import sqlite3
import sys
import time

from lxml import etree

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from disclosure import sec  # noqa: E402
from disclosure.companies import norm_name, submissions  # noqa: E402

MANAGERS = [
    102909, 2012383, 93751, 315066, 1214717, 895421, 19617, 73124, 80255, 1422848, 1422849, 1562230,
    902219, 1067983, 1374170, 70858, 886982, 1610520, 914208, 884546, 354204, 1350694, 1423053, 1037389,
    1179392, 1009207, 1273087, 1595888, 1167557, 1446194, 820027, 764068, 1000275, 38777, 1126328, 1603466,
]
MIN_VALUE = 2_000_000
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "13f.db")


def local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def parse(xml: bytes, thousands: bool) -> dict[str, dict]:
    """Equity positions summed by CUSIP. Options and principal amounts are left out."""
    out: dict[str, dict] = {}
    for _, el in etree.iterparse(__import__("io").BytesIO(xml), events=("end",), huge_tree=True, recover=True):
        if local(el.tag) != "infoTable":
            continue
        f = {local(c.tag): c for c in el.iter()}
        kind = (f.get("sshPrnamtType").text or "").strip() if f.get("sshPrnamtType") is not None else "SH"
        if kind != "SH" or (f.get("putCall") is not None and (f["putCall"].text or "").strip()):
            el.clear()
            continue
        cusip = (f["cusip"].text or "").strip().upper()
        value = float(f["value"].text or 0) * (1000 if thousands else 1)
        shares = float(f["sshPrnamt"].text or 0)
        row = out.setdefault(cusip, {"issuer": (f["nameOfIssuer"].text or "").strip(), "class": (f["titleOfClass"].text or "").strip(), "value": 0.0, "shares": 0.0})
        row["value"] += value
        row["shares"] += shares
        el.clear()
    # Values have been reported in dollars since 2023, but some filers still report thousands.
    # A median implied price under $1 a share gives that away.
    prices = sorted(r["value"] / r["shares"] for r in out.values() if r["shares"] > 0 and r["value"] > 0)
    if prices and prices[len(prices) // 2] < 1:
        for r in out.values():
            r["value"] *= 1000
    return out


async def latest_two(cik: int) -> tuple[str, list[dict]]:
    s = await submissions(cik)
    r = s["filings"]["recent"]
    # Some managers file more than one 13F-HR for a quarter (a small supplemental report next to the
    # main one, or refile the complete holdings as an amendment), so take the largest filing for
    # each of the two latest quarters.
    by_period: dict[str, dict] = {}
    for i, form in enumerate(r["form"]):
        if form not in ("13F-HR", "13F-HR/A"):
            continue
        p = r["reportDate"][i]
        if p not in by_period and len(by_period) == 2:
            break
        cur = by_period.get(p)
        if cur is None or r["size"][i] > cur["size"]:
            by_period[p] = {"accession": r["accessionNumber"][i], "period": p, "filed": r["filingDate"][i], "size": r["size"][i]}
    return s["name"], sorted(by_period.values(), key=lambda x: x["period"], reverse=True)


async def info_table(cik: int, accession: str) -> bytes:
    idx = await sec.get_json(sec.archive_url(cik, accession, "index.json"), 30 * sec.DAY)
    names = [i["name"] for i in idx["directory"]["item"] if i["name"].lower().endswith(".xml")]
    table = next((n for n in names if n.lower() != "primary_doc.xml" and "info" in n.lower()), None) or next(n for n in names if n.lower() != "primary_doc.xml")
    return await sec.get(sec.archive_url(cik, accession, table), 30 * sec.DAY)


async def main() -> None:
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    tmp = OUT + ".tmp"
    if os.path.exists(tmp):
        os.remove(tmp)
    db = sqlite3.connect(tmp)
    db.executescript("""
        CREATE TABLE managers (cik INTEGER PRIMARY KEY, name TEXT, period TEXT, prior TEXT, filed TEXT, accession TEXT, total REAL, positions INTEGER);
        CREATE TABLE issuers (cusip TEXT PRIMARY KEY, name TEXT, class TEXT, norm TEXT);
        CREATE TABLE holdings (cik INTEGER, q INTEGER, cusip TEXT, value REAL, shares REAL);
    """)
    issuers: dict[str, tuple] = {}
    t0 = time.time()
    for cik in MANAGERS:
        try:
            name, picks = await latest_two(cik)
            if not picks:
                print(f"  {cik}: no 13F-HR")
                continue
            tables = [parse(await info_table(cik, p["accession"]), thousands=p["period"] < "2022-12-31") for p in picks]
            total = sum(r["value"] for r in tables[0].values())
            # A manager granted confidential treatment files an empty report; there is nothing to compare with.
            if len(tables) > 1 and sum(r["value"] for r in tables[1].values()) < 0.05 * total:
                tables, picks = tables[:1], picks[:1]
            for q, rows in enumerate(tables):
                # Positions under MIN_VALUE are left out to keep the database small.
                db.executemany("INSERT INTO holdings VALUES (?, ?, ?, ?, ?)", [(cik, q, c, round(r["value"]), round(r["shares"])) for c, r in rows.items() if r["value"] >= MIN_VALUE])
                for c, r in rows.items():
                    issuers.setdefault(c, (r["issuer"], r["class"]))
            db.execute("INSERT INTO managers VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                       (cik, name, picks[0]["period"], picks[1]["period"] if len(picks) > 1 else None, picks[0]["filed"], picks[0]["accession"], total, len(tables[0])))
            db.commit()
            print(f"  {name}: {len(tables[0]):,} positions, ${total / 1e9:,.0f}B, {picks[0]['period']} ({time.time() - t0:.0f}s)")
        except Exception as e:  # one manager failing should not stop the build
            print(f"  {cik}: failed ({e})")
    kept = {c for (c,) in db.execute("SELECT DISTINCT cusip FROM holdings")}
    db.executemany("INSERT INTO issuers VALUES (?, ?, ?, ?)", [(c, n, k, norm_name(re.sub(r"\b(DEL|NEW|COM|CL [A-Z])\b", " ", n))) for c, (n, k) in issuers.items() if c in kept])
    db.executescript("CREATE INDEX i_norm ON issuers(norm); CREATE INDEX h_cusip ON holdings(cusip); VACUUM;")
    db.close()
    os.replace(tmp, OUT)
    print(f"Wrote {OUT} ({os.path.getsize(OUT) / 1e6:.1f} MB) in {time.time() - t0:.0f}s")


if __name__ == "__main__":
    asyncio.run(main())
