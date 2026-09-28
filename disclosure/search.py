"""Full-text search across a company's filings.

EDGAR full-text search finds which documents mention a phrase (filings
since 2001). It returns documents, not passages, so the passages are cut
from the same parsed blocks the reader uses, which also gives each excerpt
a position the reader can jump to.
"""
from __future__ import annotations

import asyncio
import re
from urllib.parse import quote

from . import document, sec
from .filings import FORM_NAMES
from .sec import HOUR

EXCERPT = 170  # characters of context on each side of a match


def efts_query(q: str) -> str:
    q = q.strip()
    # Several words without operators are searched as an exact phrase, which is what analysts mean.
    if " " in q and '"' not in q and not re.search(r"\b(AND|OR|NOT)\b", q):
        q = f'"{q}"'
    return q


def pattern(q: str) -> re.Pattern:
    words = re.findall(r'"([^"]+)"|(\S+)', q)
    terms = [a or b for a, b in words if (a or b).upper() not in ("AND", "OR", "NOT")]
    parts = [r"\s+".join(re.escape(w) for w in t.split()) for t in terms if t]
    return re.compile("|".join(f"({p})" for p in parts) or r"$^", re.I)


async def hits(cik: int, q: str, forms: str, start: str, end: str) -> dict:
    url = (f"https://efts.sec.gov/LATEST/search-index?q={quote(efts_query(q))}&ciks={sec.cik10(cik)}"
           f"&forms={quote(forms)}&dateRange=custom&startdt={start}&enddt={end}")
    j = await sec.get_json(url, 6 * HOUR)
    out = []
    for h in j.get("hits", {}).get("hits", []):
        s = h["_source"]
        acc, _, name = h["_id"].partition(":")
        if s.get("file_type") in ("XML", "GRAPHIC", "ZIP") or name.lower().endswith((".xml", ".jpg", ".gif", ".pdf")):
            continue
        out.append({"accession": acc, "file": name, "form": s.get("form"), "fileType": s.get("file_type"), "description": FORM_NAMES.get(s.get("file_type") or "", s.get("file_description")) if s.get("file_description") in (None, s.get("form"), s.get("file_type")) else s.get("file_description"),
                    "filed": s.get("file_date"), "period": s.get("period_ending"), "score": h.get("_score")})
    out.sort(key=lambda r: r["filed"] or "", reverse=True)
    forms_count = {b["key"]: b["doc_count"] for b in j.get("aggregations", {}).get("form_filter", {}).get("buckets", [])}
    return {"total": j.get("hits", {}).get("total", {}).get("value", 0), "hits": out, "forms": forms_count}


async def excerpts(cik: int, accession: str, path: str, q: str, limit: int = 3) -> dict:
    parsed = await document.load(cik, accession, path)
    rx = pattern(efts_query(q))
    out, count = [], 0
    for i, b in enumerate(parsed["blocks"]):
        text = b["text"]
        ms = list(rx.finditer(text))
        if not ms:
            continue
        count += len(ms)
        if len(out) >= limit:
            continue
        m = ms[0]
        a, z = max(0, m.start() - EXCERPT), min(len(text), m.end() + EXCERPT)
        snippet = text[a:z]
        # Start and end on word boundaries.
        if a > 0:
            snippet = "…" + snippet[snippet.find(" ") + 1:]
        if z < len(text):
            snippet = snippet[: snippet.rfind(" ")] + "…"
        html = rx.sub(lambda x: f"<mark>{x.group(0)}</mark>", snippet.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))
        out.append({"block": i, "html": html, "table": b["kind"] == "table"})
    return {"accession": accession, "file": path, "matches": count, "excerpts": out}


async def search(cik: int, q: str, forms: str, start: str, end: str, detail: int = 8) -> dict:
    res = await hits(cik, q, forms, start, end)

    async def one(h):
        try:
            return await excerpts(cik, h["accession"], h["file"], q)
        except (sec.NotFound, sec.Upstream):
            return None

    got = await asyncio.gather(*(one(h) for h in res["hits"][:detail]))
    for h, e in zip(res["hits"], got):
        if e:
            h["matches"], h["excerpts"] = e["matches"], e["excerpts"]
    return {"query": efts_query(q), **res}
