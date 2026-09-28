"""Filing comparison: one section of two filings, paragraph by paragraph."""
from __future__ import annotations

import asyncio

from . import diff, document, filings
from .sec import DAY, NotFound
from .store import memoize


def _section(blocks: list[document.Block], secs: list[dict], key: str) -> list[document.Block]:
    if key == "all":
        return blocks
    keys = [s["key"] for s in secs]
    if key not in keys:
        return []
    k = keys.index(key)
    end = secs[k + 1]["block"] if k + 1 < len(secs) else len(blocks)
    return blocks[secs[k]["block"]:end]


def _text(b: document.Block) -> str:
    # Tables compare row by row as text; figures that changed show up as word changes.
    return b.text.replace("\n", " ⏐ ") if b.kind == "table" else b.text


async def _load(cik: int, f: dict):
    parsed = await document.load(cik, f["accession"], f["doc"])
    blocks = document.restore(parsed["blocks"])
    secs, _ = document.sections(blocks, f["form"])
    return blocks, secs


@memoize("compare:v2", DAY * 30)
async def compare(cik: int, old_acc: str, new_acc: str, key: str) -> dict:
    old_f, new_f = await asyncio.gather(filings.find(cik, old_acc), filings.find(cik, new_acc))
    (ob, osec), (nb, nsec) = await asyncio.gather(_load(cik, old_f), _load(cik, new_f))
    sections = [{"key": s["key"], "label": s["label"], "title": s["title"]} for s in nsec if any(o["key"] == s["key"] for o in osec)]
    a, b = _section(ob, osec, key), _section(nb, nsec, key)
    if not a or not b:
        raise NotFound(f"Section {key} was not found in both filings")
    at, bt = [_text(x) for x in a], [_text(x) for x in b]
    rows = diff.paragraphs(at, bt)
    for r in rows:
        if r["op"] == "changed":
            r["left"], r["right"] = diff.sides(at[r["a"]], bt[r["b"]])
        elif r["op"] == "equal":
            r["left"] = r["right"] = r.pop("html")
        elif r["op"] == "added":
            r["right"] = r.pop("html")
        else:
            r["left"] = r.pop("html")
        r.pop("html", None)
        r["table"] = (b[r["b"]] if "b" in r else a[r["a"]]).kind == "table"
    words = lambda xs: sum(len(x.split()) for x in xs)
    added = sum(len(bt[r["b"]].split()) for r in rows if r["op"] == "added")
    removed = sum(len(at[r["a"]].split()) for r in rows if r["op"] == "removed")
    return {
        "old": {k: old_f[k] for k in ("accession", "form", "filed", "period")},
        "new": {k: new_f[k] for k in ("accession", "form", "filed", "period")},
        "section": key, "sections": sections,
        "summary": {
            "paragraphs": {op: sum(1 for r in rows if r["op"] == op) for op in ("equal", "changed", "added", "removed")},
            "wordsOld": words(at), "wordsNew": words(bt), "wordsAdded": added, "wordsRemoved": removed,
            "similarity": round(diff.similarity(" ".join(at), " ".join(bt)), 3) if words(at) + words(bt) < 60000 else None,
        },
        "rows": rows,
    }
