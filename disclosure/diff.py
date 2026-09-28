"""Text comparison shared by the risk-factor view and the filing comparison engine."""
from __future__ import annotations

import re
from difflib import SequenceMatcher

TOKEN = re.compile(r"\s+|[^\w\s]|\w+")
WORD = re.compile(r"[a-z0-9]+")


def _esc(s: str) -> str:
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def normalize(s: str) -> str:
    return " ".join(WORD.findall(s.lower()))


def similarity(a: str, b: str) -> float:
    """Word-level similarity from 0 to 1, fast enough for thousands of pairs."""
    wa, wb = normalize(a).split(), normalize(b).split()
    if not wa and not wb:
        return 1.0
    sm = SequenceMatcher(None, wa, wb, autojunk=False)
    if sm.real_quick_ratio() < 0.3:
        return sm.real_quick_ratio() * 0.5
    return sm.ratio()


def title_similarity(a: str, b: str) -> float:
    sa, sb = set(normalize(a).split()), set(normalize(b).split())
    if not sa or not sb:
        return 0.0
    jac = len(sa & sb) / len(sa | sb)
    return max(jac, SequenceMatcher(None, normalize(a), normalize(b)).ratio())


def words(a: str, b: str) -> str:
    """HTML of b with insertions and deletions relative to a, word by word."""
    ta, tb = TOKEN.findall(a), TOKEN.findall(b)
    sm = SequenceMatcher(None, ta, tb, autojunk=False)
    out = []
    for op, i1, i2, j1, j2 in sm.get_opcodes():
        if op == "equal":
            out.append(_esc("".join(ta[i1:i2])))
            continue
        old, new = "".join(ta[i1:i2]), "".join(tb[j1:j2])
        if old.strip():
            out.append(f"<del>{_esc(old)}</del>")
        elif old:
            out.append(_esc(old))
        if new.strip():
            out.append(f"<ins>{_esc(new)}</ins>")
        elif new and not old:
            out.append(_esc(new))
    return "".join(out)


def sides(a: str, b: str) -> tuple[str, str]:
    """Left (old, deletions marked) and right (new, insertions marked) HTML for a side-by-side view."""
    ta, tb = TOKEN.findall(a), TOKEN.findall(b)
    sm = SequenceMatcher(None, ta, tb, autojunk=False)
    left, right = [], []
    for op, i1, i2, j1, j2 in sm.get_opcodes():
        old, new = "".join(ta[i1:i2]), "".join(tb[j1:j2])
        if op == "equal":
            left.append(_esc(old))
            right.append(_esc(new))
            continue
        left.append(f"<del>{_esc(old)}</del>" if old.strip() else _esc(old))
        right.append(f"<ins>{_esc(new)}</ins>" if new.strip() else _esc(new))
    return "".join(left), "".join(right)


def paragraphs(a: list[str], b: list[str]) -> list[dict]:
    """Align two lists of paragraphs. Each row is equal, added, removed or changed (with a word diff)."""
    na, nb = [normalize(x) for x in a], [normalize(x) for x in b]
    sm = SequenceMatcher(None, na, nb, autojunk=False)
    rows: list[dict] = []
    for op, i1, i2, j1, j2 in sm.get_opcodes():
        if op == "equal":
            rows += [{"op": "equal", "a": i, "b": j, "html": _esc(b[j])} for i, j in zip(range(i1, i2), range(j1, j2))]
        elif op == "insert":
            rows += [{"op": "added", "b": j, "html": _esc(b[j])} for j in range(j1, j2)]
        elif op == "delete":
            rows += [{"op": "removed", "a": i, "html": _esc(a[i])} for i in range(i1, i2)]
        else:
            # Pair each new paragraph with its most similar old one in the replaced range.
            olds = list(range(i1, i2))
            used: set[int] = set()
            for j in range(j1, j2):
                # Short sentences share most of their words by chance ("X revenue increased 9%"),
                # so they need a closer match to count as the same paragraph.
                best, score = None, 0.5 if len(b[j].split()) > 25 else 0.72
                for i in olds:
                    if i in used:
                        continue
                    s = similarity(a[i], b[j])
                    if s > score:
                        best, score = i, s
                if best is None:
                    rows.append({"op": "added", "b": j, "html": _esc(b[j])})
                else:
                    for i in olds:  # removed paragraphs that came before the match keep their place
                        if i < best and i not in used:
                            rows.append({"op": "removed", "a": i, "html": _esc(a[i])})
                            used.add(i)
                    used.add(best)
                    rows.append({"op": "changed", "a": best, "b": j, "html": words(a[best], b[j]), "similarity": round(score, 3)})
            rows += [{"op": "removed", "a": i, "html": _esc(a[i])} for i in olds if i not in used]
    return rows
