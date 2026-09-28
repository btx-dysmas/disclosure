"""XBRL explorer: every tagged concept a company reports, its facts, and how a filing's XBRL is organized."""
from __future__ import annotations

import re

from lxml import etree

from . import sec
from .sec import DAY, HOUR
from .store import memoize


async def _facts(cik: int) -> dict:
    return await sec.get_json(f"https://data.sec.gov/api/xbrl/companyfacts/CIK{sec.cik10(cik)}.json", 6 * HOUR)


@memoize("xbrl:concepts:v1", 6 * HOUR)
async def concepts(cik: int) -> dict:
    cf = await _facts(cik)
    out = []
    for tax, group in cf.get("facts", {}).items():
        for name, node in group.items():
            units = node.get("units", {})
            rows = [r for arr in units.values() for r in arr]
            if not rows:
                continue
            latest = max(rows, key=lambda r: (r["end"], r.get("filed", "")))
            unit = next(u for u, arr in units.items() if latest in arr)
            out.append({
                "taxonomy": tax, "concept": name, "label": node.get("label") or name,
                "description": (node.get("description") or "")[:600],
                "units": list(units), "count": len(rows),
                "first": min(r["end"] for r in rows), "last": latest["end"],
                "latest": {"val": latest["val"], "unit": unit, "end": latest["end"], "form": latest.get("form"), "filed": latest.get("filed")},
            })
    out.sort(key=lambda c: (c["taxonomy"] != "us-gaap", c["label"].lower()))
    return {"entity": cf.get("entityName"), "concepts": out}


async def facts(cik: int, taxonomy: str, concept: str) -> dict:
    cf = await _facts(cik)
    node = cf.get("facts", {}).get(taxonomy, {}).get(concept)
    if not node:
        raise sec.NotFound(f"{taxonomy}:{concept} is not reported by this company")
    rows = []
    for unit, arr in node.get("units", {}).items():
        for r in arr:
            rows.append({"unit": unit, "start": r.get("start"), "end": r["end"], "val": r["val"], "form": r.get("form"),
                         "fy": r.get("fy"), "fp": r.get("fp"), "filed": r.get("filed"), "accession": r.get("accn"), "frame": r.get("frame")})
    rows.sort(key=lambda r: (r["end"], r["filed"] or ""), reverse=True)
    return {"taxonomy": taxonomy, "concept": concept, "label": node.get("label"), "description": node.get("description"), "facts": rows}


@memoize("xbrl:structure:v1", DAY * 30)
async def structure(cik: int, accession: str) -> dict:
    """The statements, notes and details in a filing's XBRL, from FilingSummary.xml, plus tag counts."""
    try:
        raw = await sec.get(sec.archive_url(cik, accession, "FilingSummary.xml"), DAY * 30)
    except sec.NotFound:
        return {"reports": [], "stats": None, "reason": "This filing has no XBRL financial data."}
    root = etree.fromstring(raw, etree.XMLParser(recover=True))
    reports = []
    for r in root.iter("Report"):
        name = r.findtext("HtmlFileName") or r.findtext("XmlFileName")
        if not name:
            continue
        reports.append({
            "file": name, "short": (r.findtext("ShortName") or "").strip(), "long": (r.findtext("LongName") or "").strip(),
            "category": (r.findtext("MenuCategory") or "Other").strip(), "position": int(r.findtext("Position") or 0),
        })
    stats = None
    try:
        ml = await sec.get_json(sec.archive_url(cik, accession, "MetaLinks.json"), DAY * 30)
        inst = next(iter(ml.get("instance", {}).values()), {})
        keys = ("elementCount", "contextCount", "segmentCount", "unitCount", "keyStandard", "keyCustom", "axisStandard", "axisCustom", "memberStandard", "memberCustom", "hidden")
        stats = {k: inst.get(k) for k in keys}
        stats["hidden"] = sum(v for v in (inst.get("hidden") or {}).values() if isinstance(v, int)) if isinstance(inst.get("hidden"), dict) else inst.get("hidden")
        stats["baseTaxonomies"] = inst.get("baseTaxonomies")
        custom = [t for t, v in inst.get("tag", {}).items() if not re.match(r"^(us-gaap|dei|srt|country|currency|exch|naics|sic|stpr|ecd|cyd|invest|ifrs-full)_", t) and v.get("xbrltype") != "domainItemType"]
        stats["customExamples"] = sorted(custom)[:40]
    except (sec.NotFound, ValueError):
        pass
    return {"reports": reports, "stats": stats}
