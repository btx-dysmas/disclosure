"""HTTP entry point. Vercel routes /api/* here; locally, run `uvicorn api.index:app --reload`."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from disclosure.app import app as _app  # noqa: E402


async def app(scope, receive, send):
    """Give the FastAPI app the full request path however the host passes it.

    Depending on how Vercel routes a request, the function sees /api/search, /search with
    root_path set to /api, or /search alone. All routes live under /api, so the path is
    rebuilt to that form and root_path cleared before routing.
    """
    if scope["type"] in ("http", "websocket") and os.environ.get("VERCEL"):
        path, root = scope.get("path", ""), scope.get("root_path", "")
        if root and not path.startswith(root):
            path = root.rstrip("/") + path
        if not path.startswith("/api"):
            path = "/api" + path
        scope = {**scope, "path": path, "raw_path": path.encode(), "root_path": ""}
    await _app(scope, receive, send)
