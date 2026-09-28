"""FastAPI application: JSON endpoints under /api, and the static front end for local runs."""
from __future__ import annotations

import os

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from . import companies
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


# Local development serves the front end from the same process; on Vercel, public/ is served by the CDN.
if not os.environ.get("VERCEL"):
    from fastapi.staticfiles import StaticFiles

    public = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "public")
    if os.path.isdir(public):
        app.mount("/", StaticFiles(directory=public, html=True), name="public")
