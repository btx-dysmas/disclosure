# Architecture

Disclosure is a FastAPI application that reads SEC EDGAR and a static front end written in plain JavaScript. There is no database server: SQLite holds a cache of downloaded and parsed filings, and a prebuilt SQLite file holds 13F holdings.

## Overview

```
public/                      disclosure/                               SEC
index.html                   app.py         routes, cache headers
js/app.js      router   ──►  companies.py   ticker, name, accession ──► company_tickers_exchange.json, EFTS
js/views/*.js  one per view  filings.py     library, latest feed    ──► submissions API, current-events feed
css/app.css                  document.py    HTML to blocks          ──► filing documents
                             segments.py    dimensional XBRL        ──► XBRL instance, MetaLinks.json
                             financials.py  statements              ──► company facts API
                             xbrl.py        concepts, structure     ──► company facts, FilingSummary.xml
                             search.py      full-text search        ──► efts.sec.gov
                             risk.py, compare.py, diff.py           (use document.py)
                             insiders.py    Form 4                  ──► Form 4 XML
                             ownership.py   13F                     ──► data/13f.db (built by scripts/build_13f.py)
                             timeline.py, insights.py               (use filings.py, financials.py, segments.py)
                             sec.py, store.py   throttled client, SQLite cache
```

On Vercel, the FastAPI app in `api/index.py` receives every request that isn't a static file in `public/`. Vercel can hand the function the path in a different form than a local server (with the `/api` prefix moved into `root_path`), so the entry point rebuilds the full path before routing. Locally, the same app mounts `public/` itself, so one `uvicorn` command runs everything.

## Talking to the SEC

`sec.get(url, ttl)` is the only way the app reaches the network.

1. **Cache.** It looks the URL up in the SQLite `http` table and returns the body if it is younger than `ttl`. Bodies are stored zlib-compressed.
2. **Rate limit.** Otherwise it waits for a slot. A lock and a timestamp keep requests at least 110 ms apart, just under the SEC's limit of ten per second.
3. **Request.** It sends the request with a declared User-Agent.
4. **Retries.** 403 and 429 are how the SEC signals too many requests, so it backs off and retries up to three times. A 404 raises `NotFound`, which the app turns into a 404 response.

Time-to-live values follow how often the data changes: the ticker list and filing indexes for hours, filing documents for a month (a filing never changes once accepted), the latest-filings feed for ten minutes.

The HTTP client and the lock are recreated whenever the running event loop changes. A serverless runtime can run each request in a fresh loop, and objects bound to a closed loop fail.

`store.memoize(prefix, ttl)` caches the JSON result of an expensive function (a parsed filing, a segment extraction) in the `parsed` table. The version number in each prefix, such as `doc:v7`, is bumped whenever the parser changes, so stale results are never served.

## Filing documents

`document.load` turns one filing document into a list of blocks, each a paragraph or a table with HTML, plain text and style flags.

1. **Clean.** Inline XBRL tags (`ix:nonFraction` and the rest) are unwrapped so their content stays, and the hidden `ix:header` is dropped along with anything styled `display:none`.
2. **Walk.** The tree is walked once. An element with no block-level descendants becomes a paragraph; its text runs are merged by style, so bold and italic survive as `<b>` and `<i>`.
3. **Tables.** Tables are rebuilt on a column grid:
   - currency signs, opening parentheses, closing parentheses and percent signs that sit in their own cells are joined to the neighbouring number
   - columns that are empty in every row are removed
   - numeric cells are right-aligned
   - indentation is kept at two levels

   A one-row table with two cells is usually a heading or a bullet, and becomes a paragraph.
4. **Tidy.** Bullet characters in their own block are joined to the following paragraph. Lines that look like page headers ("PART II", "Item 7", capitals, page numbers) and repeat five or more times are dropped.

Microsoft's 10-K goes from 8.6 MB of HTML to about 1,000 blocks and 0.4 MB.

`document.sections` finds Item headings. For 10-Qs it tracks which Part it is in, so "Part II, Item 1A" is distinct from "Part I, Item 1". Every Item heading appears at least twice (the table of contents and the body), and some filings repeat it on every page. For each Item the parser prefers an occurrence that carries a title, then the one followed by the most text before a different Item starts. Notes to the financial statements are found between Item 8 and the next Item. When Item 8 is only a pointer to statements printed after Item 15, as at NVIDIA and JPMorgan, the search runs to the end of the document.

## Segments

The company-facts API omits every fact that has a dimension, which is where segments live. `segments.py` reads the XBRL instance of each of the last three 10-Ks instead:

1. **Filter contexts.** Keep contexts that cover a full fiscal year (330 to 400 days) and carry exactly one member on the business segment, product or service, or geographic axis. `ConsolidationItemsAxis = OperatingSegmentsMember`, which many filings add next to the segment, is ignored. Contexts with no dimension give total revenue.
2. **Collect facts.** Gather revenue and operating income facts on those contexts, choosing the revenue concept used most often on each axis.
3. **Label members.** Use the company's own names from MetaLinks.json ("Intelligent Cloud", not `msft:IntelligentCloudMember`).
4. **Resolve structure.** Work out how the members of each axis relate, using the latest year's figures:
   - If they sum to total revenue, they are one breakdown.
   - If they split into two groups that each sum to total revenue (Microsoft's product lines and Product/Service), those become two views.
   - Otherwise, a member equal to the sum of smaller members is treated as their subtotal, but only if the same sum holds the year before (Apple's Products).
5. **Merge history.** Newer 10-Ks win where years overlap, so recast figures are used. When an older 10-K disagrees with a newer one on a shared year by more than 1.5%, the company reorganized, and history stops rather than mixing definitions.

## Financial statements

`financials.py` maps about 35 lines to lists of candidate US-GAAP concepts.

- **Choosing a figure.** For each period, the first candidate with a value is used and the concept is reported with it.
- **Annual and quarterly values.** Annual values are 10-K facts spanning a fiscal year; quarterly values are three-month facts. Fourth quarters are derived as the fiscal year less the first three quarters, and marked as derived.
- **Restatements.** Later filings replace earlier ones.
- **Stock splits.** A split is detected when a later filing restates a period's per-share figure by a split ratio. Walking restatements in date order, a ratio already explained by splits found in between is not counted again, so a ratio of 15 across two splits is not a third split. Values last filed before a split are then put on today's basis.

## Risk factors and comparison

`risk.split` turns Item 1A into risks. Candidate headings are paragraphs set in bold or italic, or paragraphs that start with a bold run. The most common heading style is taken as the risk level, and short headings in another style stay inside the risk as subheadings. Category headings in capitals above a risk are kept as its category.

Two years are compared by matching each new risk to the most similar old one, by heading and then by text where a heading was rewritten, and classifying the result.

`diff.paragraphs` aligns two lists of paragraphs with `difflib` on normalized text. Within each replaced run, it pairs each new paragraph with its most similar old one. Short sentences need 72% similarity instead of 50%, because lines like "X revenue increased 9%" share most of their words by chance. Paired paragraphs get a word-level diff.

## Full-text search

`search.py` sends the query to EDGAR full-text search, filtered by CIK, form and date. Several words without operators become an exact phrase. EDGAR returns matching documents, not passages, so for the top eight results the document is parsed with `document.load` and excerpts are cut around each match. Each excerpt keeps its block number, so the reader opens at that passage.

## 13F ownership

`scripts/build_13f.py` runs offline, and a scheduled GitHub Action repeats it after each quarterly filing deadline.

1. For each of 36 managers, it picks the largest 13F-HR or 13F-HR/A for each of the last two quarters.
2. It sums equity positions by CUSIP, leaving out options and principal amounts.
3. It fixes filers that still report in thousands, detected by a median implied price under $1.
4. It skips positions under $2 million and writes about 9 MB of SQLite.

`ownership.py` matches a company to 13F issuer names by normalized name, then reads each manager's position across all of the company's share classes.

## Front end

`public/js/app.js` is a hash router: `#/c/MSFT/segments` loads `views/company.js`, which renders the company header once and then the view module for the tab. Each view module exports `render(root, context)` and fetches its own data through `lib.api`, which shares identical requests that are in flight at the same time. Plotly is loaded from a CDN the first time a chart is drawn. The workspace, watchlist, notes and view preferences live in `localStorage` under a `disclosure:` prefix, and every read and write is wrapped so a blocked storage never breaks a page.

The design keeps to what research software looks like: a navy bar, white panels with one-pixel borders, dense tables with tabular figures, one typeface (Public Sans) plus a monospace for tickers, forms and accession numbers, and color only for meaning (gains, losses, insertions, deletions).
