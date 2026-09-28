"""HTTP entry point. Vercel routes /api/* here; locally, run `uvicorn api.index:app --reload`."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from disclosure.app import app  # noqa: E402,F401
