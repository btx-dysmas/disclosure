"""Segment revenue and operating income from the XBRL in each 10-K.

The SEC's company-facts API only carries consolidated figures; anything
broken down by a dimension (segment, product line, region) is left out.
Those facts are still in each filing's XBRL instance, so this module reads
the instance directly: find contexts with exactly one segment, product or
geography member, keep full fiscal years, and label members with the
company's own names from the filing's MetaLinks.json.

Three 10-Ks are read by default. Each reports three years, and the newest
filing wins where years overlap, so recast history is used when a company
reorganizes its segments.
"""
from __future__ import annotations

import json
import re
from datetime import date
from html import unescape

from lxml import etree

from . import filings, sec
from .sec import DAY
from .store import memoize

XBRLI = "http://www.xbrl.org/2003/instance"
XBRLDI = "http://xbrl.org/2006/xbrldi"

REVENUE = [
    "RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "RevenueFromContractWithCustomerIncludingAssessedTax",
    "SalesRevenueNet", "RevenuesNetOfInterestExpense", "SalesRevenueGoodsNet", "SalesRevenueServicesNet",
]
OPERATING = ["OperatingIncomeLoss", "SegmentReportingInformationOperatingIncomeLoss"]
AXES = {
    "StatementBusinessSegmentsAxis": ("segment", "Reportable segments"),
    "ProductOrServiceAxis": ("product", "Products and services"),
    "StatementGeographicalAxis": ("geography", "Geography"),
}
# Post-2024 filings often add ConsolidationItemsAxis=OperatingSegmentsMember next to the segment itself.
NEUTRAL = {("ConsolidationItemsAxis", "OperatingSegmentsMember")}
STANDARD_NS = ("us-gaap", "srt", "country", "dei")
COUNTRY = {"US": "United States", "CN": "China", "JP": "Japan", "GB": "United Kingdom", "DE": "Germany", "FR": "France", "IN": "India",
           "CA": "Canada", "IE": "Ireland", "TW": "Taiwan", "KR": "South Korea", "SG": "Singapore", "NL": "Netherlands", "CH": "Switzerland",
           "MX": "Mexico", "BR": "Brazil", "AU": "Australia", "HK": "Hong Kong", "IL": "Israel", "IT": "Italy", "ES": "Spain"}


def _local(qname: str) -> str:
    return qname.split(":")[-1]


def _days(s: str, e: str) -> int:
    return (date.fromisoformat(e) - date.fromisoformat(s)).days


def _label(member: str, labels: dict) -> str:
    key = member.replace(":", "_")
    tag = labels.get(key)
    text = None
    if tag:
        roles = tag.get("lang", {}).get("en-us", {}).get("role", {})
        text = roles.get("terseLabel") or roles.get("label")
    if not text:
        prefix, name = member.split(":", 1) if ":" in member else ("", member)
        if prefix == "country" and name in COUNTRY:
            return COUNTRY[name]
        text = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", " ", name)
    text = re.sub(r"\s*\[(Member|Domain)\]\s*$", "", unescape(text)).strip()
    for _ in range(2):  # "North America Segment Member" loses both words
        text = re.sub(r"\s+(Segment|Member)$", "", text)
    if text.isupper() and len(text) > 4:
        text = text.title()
    return text


async def _files(cik: int, accession: str) -> tuple[str | None, str | None]:
    idx = await sec.get_json(sec.archive_url(cik, accession, "index.json"), DAY * 30)
    names = [i["name"] for i in idx["directory"]["item"]]
    inst = next((n for n in names if n.endswith("_htm.xml")), None)
    if inst is None:
        inst = next((n for n in names if n.endswith(".xml") and not re.search(r"(_cal|_def|_lab|_pre|FilingSummary)\.xml$", n) and not n.startswith("R")), None)
    return inst, ("MetaLinks.json" if "MetaLinks.json" in names else None)


async def _facts(cik: int, accession: str) -> dict | None:
    """Dimensional revenue and operating-income facts from one 10-K."""
    inst, meta = await _files(cik, accession)
    if not inst:
        return None
    root = etree.fromstring(await sec.get(sec.archive_url(cik, accession, inst), DAY * 30), etree.XMLParser(huge_tree=True, recover=True))
    labels = {}
    if meta:
        try:
            ml = json.loads(await sec.get(sec.archive_url(cik, accession, meta), DAY * 30))
            for doc in ml.get("instance", {}).values():
                labels.update(doc.get("tag", {}))
        except (ValueError, sec.NotFound):
            pass

    contexts = {}
    for c in root.iter(f"{{{XBRLI}}}context"):
        period = c.find(f"{{{XBRLI}}}period")
        s, e = period.findtext(f"{{{XBRLI}}}startDate"), period.findtext(f"{{{XBRLI}}}endDate")
        if not s or not e or not 330 <= _days(s, e) <= 400:
            continue
        if next(c.iter(f"{{{XBRLDI}}}typedMember"), None) is not None:
            continue
        dims = [(m.get("dimension"), (m.text or "").strip()) for m in c.iter(f"{{{XBRLDI}}}explicitMember")]
        dims = [d for d in dims if (_local(d[0]), _local(d[1])) not in NEUTRAL]
        if not dims:
            contexts[c.get("id")] = (e, None, None)
        elif len(dims) == 1 and _local(dims[0][0]) in AXES:
            contexts[c.get("id")] = (e, AXES[_local(dims[0][0])][0], dims[0][1])

    wanted = set(REVENUE) | set(OPERATING)
    out: dict = {"total": {}, "axes": {}}  # axes[axis][concept][member][end] = value
    for el in root:
        if not isinstance(el.tag, str) or not el.tag.startswith("{"):
            continue
        ns, name = el.tag[1:].split("}")
        if name not in wanted or "fasb.org/us-gaap" not in ns:
            continue
        ctx = contexts.get(el.get("contextRef"))
        if not ctx or el.text is None or el.get("{http://www.w3.org/2001/XMLSchema-instance}nil") == "true":
            continue
        try:
            v = float(el.text)
        except ValueError:
            continue
        end, axis, member = ctx
        if axis is None:
            out["total"].setdefault(name, {})[end] = v
        else:
            out["axes"].setdefault(axis, {}).setdefault(name, {}).setdefault(member, {})[end] = v
    out["labels"] = {m: _label(m, labels) for ax in out["axes"].values() for con in ax.values() for m in con}
    return out


def _pick(concepts: dict, names: list[str]) -> str | None:
    have = [n for n in names if n in concepts]
    if not have:
        return None
    return max(have, key=lambda n: (len(concepts[n]), -names.index(n)))


def _close(a: float, b: float, tol: float = 0.006) -> bool:
    return b != 0 and abs(a / b - 1) < tol


def _subsets(members: list[str]):
    from itertools import combinations

    for size in range(2, len(members) + 1):
        yield from combinations(members, size)


def _structure(members: list[str], latest: dict, total: float | None, prior: dict | None = None) -> tuple[list[list[str]], dict[str, str]]:
    """Work out how a breakdown's members relate, using the latest year's figures.

    Companies often tag the same revenue twice. Microsoft reports Product and Service
    next to its own product lines, and Amazon reports product and service sales next to
    online stores, AWS and advertising: two complete breakdowns that each add up to total
    revenue. Apple tags Products and also iPhone, Mac and iPad, which add up to Products.
    Returns groups that each stand alone, and a map from child member to parent.
    """
    members = members[:16]
    val = {m: latest.get(m, 0.0) for m in members}
    if total and _close(sum(val.values()), total, 0.02):
        return [members], {}
    if total:
        for a in _subsets(members):
            b = [m for m in members if m not in a]
            if len(b) >= 2 and _close(sum(val[m] for m in a), total, 0.02) and _close(sum(val[m] for m in b), total, 0.02):
                first, second = (list(a), b) if len(a) >= len(b) else (b, list(a))
                keep = lambda g: sorted(g, key=lambda m: -val[m])
                return [keep(first), keep(second)], {}
    # Subtotals: a member equal to the sum of two or more smaller members.
    parent: dict[str, str] = {}
    for p in sorted(members, key=lambda m: -val[m]):
        if p in parent or val[p] <= 0:
            continue
        pool = [m for m in members if m != p and m not in parent and 0 < val[m] < val[p]]
        best, best_err = None, 0.002
        for s in _subsets(pool) if len(pool) <= 14 else ():
            err = abs(sum(val[m] for m in s) / val[p] - 1)
            # A real subtotal holds in the prior year too; a coincidence rarely does.
            if err < best_err and (not prior or not prior.get(p) or _close(sum(prior.get(m, 0) for m in s), prior[p], 0.004)):
                best, best_err = s, err
        if best:
            for c in best:
                parent[c] = p
    return [members], parent


@memoize("segments:v6", DAY)
async def segments(cik: int, count: int = 3) -> dict:
    lib = await filings.library(cik)
    tenks = [f for f in lib["filings"] if f["form"] in ("10-K", "10-KT") and f["xbrl"]][:count]
    if not tenks:
        return {"breakdowns": [], "filings": [], "reason": "No 10-K with XBRL data on file."}
    parsed = []
    for f in tenks:
        try:
            p = await _facts(cik, f["accession"])
        except (sec.NotFound, etree.XMLSyntaxError):
            p = None
        if p:
            parsed.append((f, p))
    if not parsed:
        return {"breakdowns": [], "filings": [], "reason": "The 10-K XBRL could not be read."}

    newest = parsed[0][1]
    # Consolidated revenue by year, newest filing first; older filings may use another concept.
    rev_total_concept = _pick(newest["total"], REVENUE)
    total: dict[str, float] = {}
    for concept in [rev_total_concept] + [c for c in REVENUE if c != rev_total_concept]:
        for _, p in parsed:
            for end, v in p["total"].get(concept or "", {}).items():
                total.setdefault(end, v)

    breakdowns = []
    for axis, (key, title) in ((a[0], a) for a in AXES.values()):
        concepts = newest["axes"].get(axis)
        if not concepts:
            continue
        rc = _pick(concepts, REVENUE)
        if not rc:
            continue
        oc = _pick(concepts, OPERATING)
        latest_end = max(e for vals in concepts[rc].values() for e in vals)
        latest = {m: vals.get(latest_end) for m, vals in concepts[rc].items() if vals.get(latest_end) is not None}
        members = sorted(latest, key=lambda m: -latest[m])
        prev_end = max((e for vals in concepts[rc].values() for e in vals if e < latest_end), default=None)
        prior = {m: vals[prev_end] for m, vals in concepts[rc].items() if prev_end in vals}
        groups, parent = _structure(members, latest, total.get(latest_end), prior)
        for n, group in enumerate(groups):
            # Use older 10-Ks only while they agree with newer ones on the years they share. When
            # a company reorganizes, the new 10-K recasts recent years and an older filing's
            # figures describe different segments, so the history stops there.
            usable = [parsed[0]]
            for f, p in parsed[1:]:
                older = p["axes"].get(axis, {}).get(rc, {})
                clash = False
                for m in group:
                    for end, v in older.get(m, {}).items():
                        for _, q in usable:
                            w = q["axes"].get(axis, {}).get(rc, {}).get(m, {}).get(end)
                            if w and v and abs(v / w - 1) > 0.015:
                                clash = True
                if clash:
                    break
                usable.append((f, p))
            rows = []
            years: set[str] = set()
            for m in group:
                rev: dict[str, float] = {}
                op: dict[str, float] = {}
                label = newest["labels"].get(m, m)
                for _, p in usable:  # newest first: recast figures take priority
                    for end, v in p["axes"].get(axis, {}).get(rc, {}).get(m, {}).items():
                        rev.setdefault(end, v)
                    if oc:
                        for end, v in p["axes"].get(axis, {}).get(oc, {}).get(m, {}).items():
                            op.setdefault(end, v)
                years |= set(rev)
                rows.append({"member": m, "label": label, "revenue": rev, "operatingIncome": op or None, "parent": parent.get(m)})
            # Children follow their parent.
            top = [r for r in rows if not r["parent"]]
            ordered = []
            for r in top:
                ordered.append(r)
                ordered += [c for c in rows if c["parent"] == r["member"]]
            rows = ordered
            ys = sorted(y for y in years if y <= latest_end)[-6:]
            sums = {y: sum(r["revenue"].get(y, 0) for r in top) for y in ys}
            # Drop early years that today's members only partly cover (before a reorganization).
            ys = [y for y in ys if (total.get(y) and sums[y] / total[y] >= 0.85) or (not total.get(y) and sum(1 for r in top if y in r["revenue"]) == len(top))]
            tot = [total.get(y) for y in ys]
            sums = [sums[y] for y in ys]
            breakdowns.append({
                "key": f"{key}{'-alt' if n else ''}", "axis": key,
                "title": title if n == 0 else f"{title} (summary)", "concept": rc, "operatingConcept": oc if any(r["operatingIncome"] for r in rows) else None,
                "years": ys, "total": tot,
                "coverage": [s / t if t else None for s, t in zip(sums, tot)],
                "restated": len(usable) < len(parsed),
                "rows": [{"member": r["member"], "label": r["label"], "parent": r["parent"],
                          "revenue": [r["revenue"].get(y) for y in ys],
                          "operatingIncome": [r["operatingIncome"].get(y) for y in ys] if r["operatingIncome"] else None} for r in rows],
            })
    order = {"segment": 0, "product": 1, "geography": 2}
    breakdowns.sort(key=lambda b: (order[b["axis"]], b["key"].endswith("-alt")))
    return {
        "breakdowns": breakdowns,
        "filings": [{"accession": f["accession"], "filed": f["filed"], "period": f["period"]} for f, _ in parsed],
        "totalConcept": rev_total_concept,
        "reason": None if breakdowns else "The 10-K does not tag revenue by segment, product or region.",
    }
