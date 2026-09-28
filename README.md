# Disclosure

Company research built directly on SEC filings.

Work in progress. The first piece is a small FastAPI service that looks up companies by ticker, name or accession number and reads their EDGAR profile.

```bash
pip install -r requirements.txt
uvicorn api.index:app --reload
```
