# Development log

Built from September 28, 2026 through October 2026.

## The starting point

The first version was a small FastAPI service: look up a company by ticker, name or accession number and return its EDGAR profile. The two pieces that stayed are the throttled EDGAR client, which keeps every request under the SEC's ten-per-second limit and sends a declared User-Agent, and the SQLite cache behind it.

Accession-number lookup was the first surprise. An accession number starts with the filer agent's CIK, not the company's, so it can't be turned into a URL directly. EDGAR full-text search indexes accession numbers, so searching for one returns the company.

## Library, reader, segments and statements

**Filing library.** I added the filing library and a plain JavaScript front end. The library shows every form type with 8-K item codes translated into plain English, and filters by form group, date and keyword. Microsoft has more than 4,500 filings, so only the most recent 1,000 load at first, with the rest on request.

**Reader.** Rendering filings inside the app meant rebuilding them. Raw EDGAR HTML carries inline XBRL, a hidden fact header and tables where "$", "(" and ")" each sit in their own cell. The parser turns a Microsoft 10-K of several megabytes into about 1,000 blocks. Section detection worked on the first filings I tried, then failed on Microsoft. Its 10-K repeats "PART II" and "Item 7" at the top of every page, so the heading with the most text after it was a page header, not the section. The fix had two parts: prefer headings that carry a title, and measure the text up to the next *different* Item. NVIDIA and JPMorgan needed one more rule, because their Item 8 only points to statements printed after Item 15.

**Segments.** This is the feature I most wanted and the one that took the most care, because the company-facts API leaves out every dimensional fact. Reading the XBRL instance directly worked for Microsoft on the first try. Then:
- **Microsoft and Amazon:** each reports two complete breakdowns on the same axis, so shares added up to 200%.
- **Apple:** reports Products next to iPhone, Mac and iPad.
- **NVIDIA:** its small OEM line happened to fit Data Center's subtotal within rounding. Requiring the sum to hold in the prior year too fixed it.
- **Reorganizations:** when a company reorganizes, its newest 10-K recasts recent years, while an older 10-K describes different segments under the same member names. Merging them would produce jumps that aren't real, so segment history stops where an older filing disagrees with a newer one.

**Statements.** Standardized statements came together quickly, except for per-share figures. NVIDIA's EPS jumped around because of its 2021 and 2024 splits. Split detection from restatements fixed NVIDIA and Apple, but made Tesla's early years 15 times too small: one period had been reported before and after both of its splits. Ratios already explained by known splits are now ignored.

After that I got tired of the project and put it down for a few months.

## Summary, XBRL, search, risk factors and comparison

**Summary.** When I came back, I added the company overview with a summary written by rules from the statements. Banks needed their own rules, since debt ratios built for industrial companies mislead for a balance sheet funded by deposits.

**XBRL explorer.** It shows every tagged fact and how a filing's XBRL is organized.

**Full-text search.** It uses EDGAR's index to find documents, then cuts excerpts from the same parsed blocks the reader uses, so every excerpt opens at its passage.

**Risk factors.** Splitting risk factors by bold headings worked for Apple and NVIDIA, but gave Microsoft 11 risks instead of about 30. Microsoft sets some risks as bold standalone lines and others as bold text at the start of a paragraph, and uses bold italic for topics inside a risk. Using punctuation to tell risks from subheadings failed, because some of Microsoft's risk headings have no period. What worked was taking the most common heading style as the risk level.

**Comparison.** The comparison engine aligns paragraphs by content. Short sentences like "Xbox content and services revenue increased 16%" were being paired with unrelated ones like "Azure and other cloud services revenue increased 41%", so short paragraphs now need a closer match.

## Insiders, ownership, tests and deployment

I picked the project up again after more than a year and finished the rest of it.

**Insiders.** Form 4 has flagged trades under Rule 10b5-1 plans since 2023, which separates scheduled selling from discretionary trades; the insiders view counts both.

**13F ownership.** The 13F database surfaced three filer quirks, each needing its own rule:
- T. Rowe Price reported values in thousands.
- JPMorgan's original March report was incomplete; the complete one was an amendment.
- Norges Bank filed an empty report under confidential treatment.

**Deployment and tests.** The last bug was the most instructive. The HTTP client and rate-limit lock were created once and tied to the first event loop. Running the API the way a serverless host does, with a new loop per request, failed on every request after the first. The client is now rebound whenever the loop changes. I also wrote tests for every parser on small inline examples of the cases above. Writing them found two more bugs: the page-header filter was dropping real sentences, and some segment labels kept the word "Segment".
