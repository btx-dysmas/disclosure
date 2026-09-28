"""SEC EDGAR client: one throttled HTTP path, backed by a SQLite cache.

The SEC asks automated clients to identify themselves with a name and contact
email and to stay under ten requests a second. Every request in the app goes
through `get`, which enforces both and caches the body so a page that needs
the same filing twice only downloads it once.
"""
from __future__ import annotations

import asyncio
import os
import time

import httpx

from .store import cache_get, cache_put

USER_AGENT = os.environ.get("SEC_USER_AGENT", "").strip() or "Disclosure research tool admin@example.com"
MIN_INTERVAL = 0.11  # seconds between requests: just under the SEC's 10 per second

HOUR = 3600
DAY = 24 * HOUR


class NotFound(Exception):
    """The SEC returned 404, or a lookup matched nothing."""


class Upstream(Exception):
    """The SEC could not be reached or kept failing."""


_client: httpx.AsyncClient | None = None
_lock = asyncio.Lock()
_last = 0.0


def client() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(
            headers={"User-Agent": USER_AGENT, "Accept-Encoding": "gzip, deflate"},
            timeout=httpx.Timeout(45.0, connect=10.0),
            follow_redirects=True,
        )
    return _client


async def _turn() -> None:
    """Wait for this request's slot so the process never exceeds the SEC's rate."""
    global _last
    async with _lock:
        wait = _last + MIN_INTERVAL - time.monotonic()
        if wait > 0:
            await asyncio.sleep(wait)
        _last = time.monotonic()


async def get(url: str, ttl: int = DAY) -> bytes:
    """Body of `url`, from the cache when it is younger than `ttl` seconds."""
    hit = cache_get(url, ttl)
    if hit is not None:
        return hit
    last = ""
    for attempt in range(3):
        await _turn()
        try:
            r = await client().get(url)
        except httpx.HTTPError as e:
            last = type(e).__name__
        else:
            if r.status_code == 200:
                cache_put(url, r.content)
                return r.content
            if r.status_code == 404:
                raise NotFound(url)
            last = f"HTTP {r.status_code}"
        # 403 and 429 are the SEC's rate-limit answers; back off before retrying.
        await asyncio.sleep(0.8 * (attempt + 1))
    raise Upstream(f"SEC request failed ({last}): {url}")


async def get_json(url: str, ttl: int = DAY):
    import json

    return json.loads(await get(url, ttl))


async def get_text(url: str, ttl: int = DAY) -> str:
    raw = await get(url, ttl)
    for enc in ("utf-8", "cp1252", "latin-1"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", "replace")


def cik10(cik: int | str) -> str:
    return str(int(cik)).zfill(10)


def archive_url(cik: int | str, accession: str, name: str = "") -> str:
    return f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/{accession.replace('-', '')}/{name}"
