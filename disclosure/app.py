"""FastAPI application: JSON endpoints under /api, and the static front end for local runs."""
from __future__ import annotations

import os

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from . import companies, document, filings, financials, insights, segments, xbrl
from .sec import NotFound, Upstream

app = FastAPI(title="Disclosure", docs_url="/api/docs", openapi_url="/api/openapi.json")


@app.exception_handler(NotFound)
async def not_found(_: Request, e: NotFound):
    return JSONResponse({"detail": str(e)}, status_code=404)


@app.exception_handler(Upstream)
async def upstream(_: Request, e: Upstream):
    return JSONResponse({"detail": str(e)}, status_code=502)


def cached(body, seconds: int = 3600):
    """JSON with a CDN cache header, so repeat requests never reach the function."""
    return JSONResponse(body, headers={"Cache-Control": f"public, s-maxage={seconds}, stale-while-revalidate={seconds * 4}"})


@app.get("/api/search")
async def search(q: str):
    return cached(await companies.search(q), 3600)


@app.get("/api/company/{key}")
async def company(key: str):
    return cached(await companies.profile(await companies.resolve(key)), 3600)


@app.get("/api/company/{key}/filings")
async def company_filings(key: str, full: bool = False):
    return cached(await filings.library(await companies.resolve(key), full), 1800)


@app.get("/api/company/{key}/latest")
async def latest_filing(key: str, forms: str = "10-K,10-Q,20-F,40-F"):
    """Accession of the most recent filing of the given forms, for links like 'open the latest 10-K'."""
    cik = await companies.resolve(key)
    want = set(forms.split(","))
    lib = await filings.library(cik)
    hit = next((f for f in lib["filings"] if f["form"] in want), None)
    if hit is None:
        raise NotFound(f"No {forms} filing on record")
    return cached(hit, 1800)


@app.get("/api/company/{key}/financials")
async def company_financials(key: str):
    body = await financials.statements(await companies.resolve(key))
    return cached({**body, "layout": financials.LAYOUT}, 21600)


@app.get("/api/company/{key}/insights")
async def company_insights(key: str):
    cik = await companies.resolve(key)
    fin = await financials.statements(cik)
    try:
        seg = await segments.segments(cik)
    except (NotFound, Upstream):
        seg = None
    sic = int((await companies.submissions(cik)).get("sic") or 0)
    return cached(insights.generate(fin, seg, financial=6000 <= sic < 6800), 21600)


@app.get("/api/company/{key}/xbrl")
async def xbrl_concepts(key: str):
    return cached(await xbrl.concepts(await companies.resolve(key)), 21600)


@app.get("/api/company/{key}/xbrl/{taxonomy}/{concept}")
async def xbrl_facts(key: str, taxonomy: str, concept: str):
    return cached(await xbrl.facts(await companies.resolve(key), taxonomy, concept), 21600)


@app.get("/api/filing/{key}/{accession}/structure")
async def filing_structure(key: str, accession: str):
    return cached(await xbrl.structure(await companies.resolve(key), accession), 86400)


@app.get("/api/company/{key}/segments")
async def company_segments(key: str):
    return cached(await segments.segments(await companies.resolve(key)), 21600)


@app.get("/api/filing/{key}/{accession}")
async def filing(key: str, accession: str, doc: str | None = None):
    """A filing document as clean blocks, with its sections, notes and the other documents in the filing."""
    cik = await companies.resolve(key)
    row = await filings.find(cik, accession)
    docs = await document.documents(cik, accession)
    path = doc or row["doc"]
    parsed = await document.load(cik, accession, path)
    blocks = document.restore(parsed["blocks"])
    secs, notes = document.sections(blocks, row["form"]) if path == row["doc"] else ([], [])
    body = {
        "filing": row, "documents": docs, "path": path, "url": parsed["url"], "unsupported": parsed.get("unsupported"),
        "blocks": [["t" if b.kind == "table" else "h" if document._heading(b) else "p", b.html] for b in blocks],
        "sections": secs, "notes": notes,
    }
    return cached(body, 86400)


# Local development serves the front end from the same process; on Vercel, public/ is served by the CDN.
if not os.environ.get("VERCEL"):
    from fastapi.staticfiles import StaticFiles

    public = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "public")
    if os.path.isdir(public):
        app.mount("/", StaticFiles(directory=public, html=True), name="public")
