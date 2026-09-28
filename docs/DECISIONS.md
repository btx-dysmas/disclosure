# Design decisions

Each entry records the context, what I chose, the alternatives, and what it cost.

## 1. SEC EDGAR as the only source

**Context.** The point of the project is to answer questions from what a company is legally required to disclose. Financial data providers are convenient, but their numbers are already standardized, which hides how the company actually reported them, and the useful ones cost money.

**Decision.** Every figure and every passage comes from EDGAR: the submissions and company-facts APIs, the filings themselves, full-text search, Form 4 and 13F.

**Alternatives.** Financial Modeling Prep or Finnhub free tiers for statements and segments. Their free plans exclude segment data and transcripts, and I couldn't see how their figures were computed.

**Consequences.** More parsing work, especially for segments. In return every number links to the filing and XBRL concept it came from, and the project costs nothing to run.

## 2. Python and FastAPI

**Context.** The heavy lifting is document parsing: HTML cleaning, XML, text alignment. Python has `lxml` and `difflib` in or near the standard library.

**Decision.** FastAPI with async handlers and `httpx`, deployed as a single Vercel Python function.

**Alternatives.** Node, which I used for Intrinsic. Parsing inline XBRL and aligning paragraphs is simpler with `lxml` and `difflib`.

**Consequences.** One process handles all routes, so the SEC rate limit is enforced in one place.

## 3. Plain JavaScript on the front end

**Decision.** ES modules, a hash router and one module per view, with no framework and no build step.

**Why.** The pages are mostly tables and text. A framework would add a build step and dependencies without making those pages better, and plain modules load fast from a CDN edge.

**Consequences.** Views render HTML strings, and user text is escaped by hand with one `esc` helper. That works at this size; it would become error-prone in a much larger app.

## 4. Rebuild filings instead of embedding them

**Context.** A 10-K's HTML is 5 to 15 MB of inline XBRL, fixed-width layout and spacer cells. Vercel functions return at most 4.5 MB, and in-document search and section jumps need a DOM the app controls.

**Decision.** Parse each filing into paragraphs and tables with bold and italic preserved, merge split currency and parenthesis cells, and drop hidden and empty content.

**Alternatives.** An iframe of the original filing, which is too large to proxy and leaves search and navigation to the browser. Linking out to EDGAR, which the brief ruled out.

**Consequences.** Formatting is simplified (no original fonts or page layout), and the reader says so and links to the original. Every other feature reuses the same blocks: search excerpts, risk factors and comparison.

## 5. Choosing the right Item heading

**Context.** "Item 7" appears in the table of contents, at the real section, and on some filings at the top of every page.

**Decision.** Prefer occurrences that carry a title, and among those the one followed by the most text before a different Item begins. Drop short header-like lines that repeat five or more times.

**Alternatives.** Taking the last occurrence, which fails when page headers repeat Items. Taking the first after the table of contents, which requires finding where the table of contents ends, and that varies by filing agent.

**Consequences.** Works on every filing tested (Microsoft, Apple, NVIDIA, Tesla, JPMorgan, Berkshire, Coca-Cola, Amazon). The repeat rule is limited to header-like lines, because a first version also removed real sentences like "Not applicable.".

## 6. Segments from XBRL instances

**Context.** The company-facts API has no dimensional facts, so it has no segments.

**Decision.** Download the XBRL instance of the last three 10-Ks and read contexts with exactly one segment, product or geography member. Label members from MetaLinks.json.

**Alternatives.** Parsing the segment note's HTML table, which is fragile because every company lays it out differently. The SEC frames API, which also lacks dimensions.

**Consequences.** About 11 MB downloaded per 10-K on first view, then cached. Structure detection handles overlapping tags. Where it can't separate them (Tesla, Berkshire), the page shows the figures as filed with a note instead of guessing.

## 7. When to stop merging older segment history

**Context.** Microsoft reorganized its segments in 2025. The 2025 and 2026 10-Ks recast recent years; the 2024 10-K has the old definitions under the same member names.

**Decision.** Merge older 10-Ks only while they agree with newer ones on the years they share. A disagreement over 1.5% ends the history.

**Consequences.** Shorter history after reorganizations, but no year shows a jump that is really a change in definitions. The page notes when this happened.

## 8. Detecting stock splits from the filings

**Context.** Companies restate per-share history after a split, but a year that only appears in pre-split filings keeps the old basis, so NVIDIA's EPS series jumped by 40 times.

**Decision.** Find splits where a later filing restates a period by a known split ratio, then adjust values last filed before that date.

**Alternatives.** A table of known splits, which would need maintaining and wouldn't cover arbitrary tickers.

**Consequences.** Needed one refinement: a period reported before and after two splits shows their product (Tesla's 15), so ratios explained by splits already found in between are ignored.

## 9. Rules instead of a language model for commentary

**Decision.** The summary is written by rules, each stating its figures and firing only when its inputs exist.

**Why.** Every sentence can be checked against the statements, it can't invent a number, and it costs nothing. Banks get separate rules, because debt-to-equity and net debt mean something different when deposits fund the balance sheet.

**Consequences.** The commentary is plainer than a model's and covers only what the rules anticipate.

## 10. Matching risk factors by style, then text

**Context.** Companies set risk headings in bold, italic, bold italic, or as a bold run at the start of a paragraph. Microsoft also puts short bold-italic topics inside a risk.

**Decision.** Take the most common heading style as the risk level; short headings in other styles stay in the body. Match years by heading similarity, then by text where a heading was rewritten.

**Alternatives.** Ending punctuation (risk headings are sentences). Microsoft's aren't always, so that approach turned about 12 subheadings into "removed risks".

**Consequences.** Rewritten risks whose heading and text both changed substantially show as one added and one removed, which is arguably what happened.

## 11. A prebuilt 13F database

**Context.** A 13F lists a manager's holdings, so "who owns this company" requires reading every manager's filing.

**Decision.** An offline script reads the last two quarters for 36 of the largest managers into a 9 MB SQLite file, refreshed by a scheduled GitHub Action.

**Alternatives.** The SEC's quarterly 13F data sets (hundreds of MB, too large for free hosting), or live requests (dozens of 10 to 20 MB downloads per page view).

**Consequences.** Coverage is the largest managers rather than all 7,000 filers, which the page states. Building it surfaced three filer quirks that each needed a rule: values in thousands, complete holdings refiled as an amendment, and an empty confidential filing.

## 12. SQLite as a cache, localStorage for the workspace

**Context.** The brief called for SQLite and for saving companies, filings, notes and ideas without a login. Vercel's filesystem is read-only except `/tmp`.

**Decision.** SQLite caches HTTP bodies and parsed results in `/tmp` on Vercel and in `.cache/` locally. The workspace lives in the browser, with export and import to move it.

**Alternatives.** A hosted database for workspaces, which would need accounts and a paid tier to be reliable.

**Consequences.** The cache resets when a function instance is recycled, so first views are slower. Workspace data stays private to the browser, and the export button exists because it can be lost if the browser's storage is cleared.

## 13. Visual design

**Decision.** Navy bar, white panels, one-pixel borders, dense tables with tabular figures, Public Sans with IBM Plex Mono for identifiers, and color used only for meaning.

**Why.** The audience reads tables and filings for long stretches. I also deliberately avoided the patterns that make a site read as generated: gradients, glow effects, icon-card grids, centered hero sections, emoji and pill badges everywhere.
