"""Risk factors: split Item 1A into individual risks, compare years, and track themes.

A 10-K's risk factors are a run of headings, each followed by a few
paragraphs. Headings are set in bold or italic, and many companies group
them under category headings. The split uses the same parsed blocks as the
reader, so a risk links straight to its place in the filing.
"""
from __future__ import annotations

import asyncio
import re
from html import unescape

from . import diff, document, filings
from .sec import DAY, NotFound, Upstream
from .store import memoize

THEMES = {
    "Cybersecurity": r"cyber|data breach|ransomware|hack|malware|security incident",
    "Artificial intelligence": r"artificial intelligence|\bAI\b|machine learning|generative|large language model",
    "Regulation": r"regulat|antitrust|competition law|legislation|compliance",
    "Competition": r"compet",
    "Supply chain": r"supply chain|supplier|component|manufactur|sourcing",
    "Macroeconomic": r"inflation|recession|interest rate|economic condition|macroeconomic|downturn",
    "Trade and geopolitics": r"tariff|trade restriction|export control|sanction|geopolitic|\bwar\b|conflict",
    "Climate": r"climate|emission|sustainab|extreme weather",
    "Talent": r"key personnel|talent|attract and retain|employees",
    "Litigation": r"litigation|lawsuit|legal proceeding|class action",
    "Pandemic": r"pandemic|covid|epidemic|public health",
    "Tax": r"\btax",
}
_THEMES = {k: re.compile(v, re.I if k != "Artificial intelligence" else 0) for k, v in THEMES.items()}
_AI = re.compile(r"artificial intelligence|machine learning|generative|large language model", re.I)


def _is_heading(b: document.Block) -> bool:
    return b.kind == "p" and (b.bold or b.italic) and 20 <= len(b.text) <= 700


def _is_category(b: document.Block) -> bool:
    return b.kind == "p" and (b.bold or b.text.isupper()) and len(b.text) < 90 and not b.text.rstrip().endswith((".", ":"))


RUN_IN = re.compile(r"^\s*<b>(.*?)</b>", re.S)


def _run_in(b: document.Block) -> tuple[str, bool] | None:
    """A heading set in bold at the start of a paragraph, with the body following on the same line."""
    if b.kind != "p" or b.bold:
        return None
    m = RUN_IN.match(b.html)
    if not m:
        return None
    title = unescape(re.sub(r"<[^>]+>", "", m[1])).strip()
    return (title, "<i>" in m[1]) if 25 <= len(title) <= 600 and len(title) < len(b.text) - 20 else None


def split(blocks: list[document.Block], start: int, end: int) -> list[dict]:
    # First pass: every candidate heading with its style. The most common style marks a risk;
    # short headings in another style are subheadings inside a risk (Microsoft sets risks in bold
    # and topics within them in bold italic) and stay in the body.
    cands = {}
    for i in range(start + 1, end):
        b = blocks[i]
        if _is_heading(b):
            cands[i] = (b.text.strip(), None, (b.bold, b.italic))
        else:
            r = _run_in(b)
            if r:
                cands[i] = (r[0], b.text[len(r[0]):].strip(), (True, r[1]))
    styles: dict[tuple, int] = {}
    for _, _, s in cands.values():
        styles[s] = styles.get(s, 0) + 1
    main = max(styles, key=styles.get) if styles else None

    factors: list[dict] = []
    category = None
    cur = None
    for i in range(start + 1, end):
        b = blocks[i]
        if i not in cands and _is_category(b) and (i + 1 < end and (i + 1) in cands):
            category = b.text.strip()
            continue
        if i in cands and (cands[i][2] == main or len(cands[i][0]) >= 150 or cur is None):
            title, rest, _ = cands[i]
            cur = {"title": title, "category": category, "block": i, "body": [rest] if rest else []}
            factors.append(cur)
        elif cur is not None and b.kind == "p":
            cur["body"].append(b.text)
    # Filers that set no risk headings apart: treat each paragraph as a risk, titled by its first sentence.
    paragraphs = sum(1 for i in range(start + 1, end) if blocks[i].kind == "p" and len(blocks[i].text) > 120)
    if not factors or (len(factors) < 3 and paragraphs > 10):
        factors = []
        for i in range(start + 1, end):
            b = blocks[i]
            if b.kind == "p" and len(b.text) > 120:
                first = re.split(r"(?<=[.;])\s", b.text, 1)[0]
                factors.append({"title": first[:300], "category": None, "block": i, "body": [b.text]})
    for f in factors:
        f["text"] = "\n\n".join(f.pop("body"))
        f["words"] = len((f["title"] + " " + f["text"]).split())
    return factors


async def _risk_section(cik: int, f: dict) -> dict | None:
    parsed = await document.load(cik, f["accession"], f["doc"])
    blocks = document.restore(parsed["blocks"])
    secs, _ = document.sections(blocks, f["form"])
    keys = [s["key"] for s in secs]
    key = "1A" if "1A" in keys else "II-1A" if "II-1A" in keys else None
    if key is None:
        return None
    k = keys.index(key)
    start = secs[k]["block"]
    end = secs[k + 1]["block"] if k + 1 < len(secs) else len(blocks)
    return {"filing": {"accession": f["accession"], "form": f["form"], "filed": f["filed"], "period": f["period"]}, "factors": split(blocks, start, end)}


@memoize("risk:years:v6", DAY)
async def years(cik: int, count: int = 5) -> dict:
    lib = await filings.library(cik)
    tenks = [f for f in lib["filings"] if f["form"] in ("10-K", "20-F")][:count]
    got = await asyncio.gather(*(_safe(cik, f) for f in tenks))
    got = [g for g in got if g and g["factors"]]
    theme_rows = []
    for g in got:
        text = " ".join(f["title"] + " " + f["text"] for f in g["factors"])
        n = max(1, len(text.split()))
        counts = {}
        for name, rx in _THEMES.items():
            hits = len(rx.findall(text)) + (len(_AI.findall(text)) if name == "Artificial intelligence" else 0) * 0
            counts[name] = round(hits / n * 10000, 1)
        theme_rows.append(counts)
    return {
        "filings": [{**g["filing"], "count": len(g["factors"]), "words": sum(f["words"] for f in g["factors"]),
                     "categories": sorted({f["category"] for f in g["factors"] if f["category"]})} for g in got],
        "themes": {"names": list(THEMES), "values": theme_rows},
    }


async def _safe(cik: int, f: dict):
    try:
        return await _risk_section(cik, f)
    except (NotFound, Upstream):
        return None


@memoize("risk:compare:v8", DAY * 30)
async def compare(cik: int, old_acc: str, new_acc: str) -> dict:
    lib = await filings.library(cik)
    by_acc = {f["accession"]: f for f in lib["filings"]}
    if old_acc not in by_acc or new_acc not in by_acc:
        raise NotFound("Filing not found in this company's recent filings")
    a, b = await asyncio.gather(_risk_section(cik, by_acc[old_acc]), _risk_section(cik, by_acc[new_acc]))
    if not a or not b:
        raise NotFound("Risk factors section not found in one of the filings")
    old, new = a["factors"], b["factors"]

    # Match each new risk to the most similar old one, by heading first, then by body.
    pairs = []
    for j, nf in enumerate(new):
        for i, of in enumerate(old):
            t = diff.title_similarity(of["title"], nf["title"])
            if t >= 0.45:
                pairs.append((t, i, j))
    pairs.sort(reverse=True)
    match_new, match_old = {}, {}
    for t, i, j in pairs:
        if i in match_old or j in match_new:
            continue
        if t < 0.75 and diff.similarity(old[i]["text"], new[j]["text"]) < 0.5:
            continue
        match_old[i], match_new[j] = j, i
    # Headings rewritten beyond recognition can still be matched by their text.
    for j, nf in enumerate(new):
        if j in match_new:
            continue
        best, score = None, 0.55
        for i, of in enumerate(old):
            if i in match_old:
                continue
            s = diff.similarity(of["text"], nf["text"])
            if s > score:
                best, score = i, s
        if best is not None:
            match_old[best], match_new[j] = j, best

    rows = []
    for j, nf in enumerate(new):
        if j not in match_new:
            rows.append({"status": "added", "title": nf["title"], "category": nf["category"], "block": nf["block"], "words": nf["words"], "html": diff._esc(nf["text"])})
            continue
        of = old[match_new[j]]
        same_title = diff.normalize(of["title"]) == diff.normalize(nf["title"])
        body_sim = diff.similarity(of["text"], nf["text"])
        if same_title and diff.normalize(of["text"]) == diff.normalize(nf["text"]):
            status = "unchanged"
        elif same_title and body_sim > 0.985:
            status = "minor"
        else:
            status = "modified"
        rows.append({
            "status": status, "title": nf["title"], "oldTitle": None if same_title else of["title"], "category": nf["category"], "block": nf["block"],
            "words": nf["words"], "wordChange": nf["words"] - of["words"], "similarity": round(body_sim, 3),
            "titleHtml": None if same_title else diff.words(of["title"], nf["title"]),
            "html": diff.words(of["text"], nf["text"]) if status != "unchanged" else None,
        })
    for i, of in enumerate(old):
        if i not in match_old:
            rows.append({"status": "removed", "title": of["title"], "category": of["category"], "block": of["block"], "words": of["words"], "html": diff._esc(of["text"])})
    summary = {s: sum(1 for r in rows if r["status"] == s) for s in ("added", "removed", "modified", "minor", "unchanged")}
    return {"old": a["filing"], "new": b["filing"], "summary": summary, "rows": rows}
