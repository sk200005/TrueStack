# Product Requirements Document (PRD)
## Re-Search: Multi-Source Public Opinion Research & Verification Platform

**Version:** 1.0
**Author:** SK
**Status:** Draft
**Last Updated:** July 2026

---

## 1. Overview

### 1.1 Problem Statement
When people want to understand public opinion on a topic (a product, a policy, a piece of news), they have to manually visit multiple platforms — Reddit, YouTube comments, Wikipedia, e-commerce reviews, news sites — read through scattered, noisy, and often contradictory content, and mentally synthesize it themselves. This is slow, biased toward whatever the person reads first, and has no built-in way to check whether popular claims are actually true.

### 1.2 Product Vision
Re-Search is a research assistant that takes a natural-language query, autonomously gathers opinions and information from multiple public platforms, synthesizes them into a structured, sourced summary, and cross-verifies the most-repeated claims against independent sources (news, fact-check databases). The output is a single, trustworthy report instead of ten open browser tabs.

### 1.3 Goals
- Reduce the time to get a reliable, multi-source "public opinion snapshot" on any topic from ~30-60 minutes of manual browsing to under 2 minutes.
- Surface not just sentiment ("mostly positive") but *why* — themes, common complaints, common praise.
- Flag which popular claims are verified, disputed, or unverifiable, with sources.

### 1.4 Non-Goals (v1)
- Not a general-purpose chatbot — scope is limited to "research a topic across public sources."
- Not a real-time/live-monitoring tool (no continuous tracking of a topic over time in v1).
- Not designed to fetch private/paywalled/authenticated content.

---

## 2. Target Users

| User Type | Use Case |
|---|---|
| Consumers | "Is this phone/laptop/appliance actually good before I buy it?" |
| Students/Researchers | Quick literature-style scan of public sentiment on a social or policy topic |
| Curious individuals | "What does the internet actually think about X?" |
| (Portfolio context) Recruiters/Interviewers | Evaluating this as a demonstration of full-stack + AI orchestration skill |

---

## 3. User Stories

1. As a user, I can type a natural-language query (e.g., "Is the iPhone 16 battery life good?") and get a synthesized report without visiting any source myself.
2. As a user, I can see which platforms were used to generate the report (transparency).
3. As a user, I can see a sentiment breakdown (positive/negative/neutral %) with representative quotes and links to original sources.
4. As a user, I can see the most repeated/popular claims about the topic, each marked as Verified / Disputed / Unverified, with the verifying source linked.
5. As a user, I can watch the research happen in near real-time (progress updates: "Fetching Reddit... Analyzing YouTube transcripts...") rather than stare at a blank loader.
6. As a user, I can save past reports and revisit them later (requires login).
7. As a user, I can export or share a report (v2 — stretch goal).
8. As a user, if a source fails to fetch (e.g., Amazon scraping blocked), I still get a report from the remaining sources, with a note about what was skipped.

---

## 4. Scope

### 4.1 In-Scope Sources (v1)
| Source | Method | Priority |
|---|---|---|
| Wikipedia | Official REST API | P0 (build first — simplest) |
| Reddit | Official API (PRAW / OAuth) | P0 |
| YouTube | Data API (search) + transcript extraction | P0 |
| News (for verification) | NewsAPI / GDELT | P0 |
| Amazon / Flipkart | Web scraping (Playwright) | P1 (build last, optional/pluggable — treat as "best effort") |
| Fact-check databases | Google Fact Check Tools API | P2 (stretch) |

### 4.2 Core Features (v1 / MVP)
- Query input + intelligent source routing (auto-decide which platforms are relevant to the query)
- Parallel multi-source data fetching with graceful degradation on failure
- RAG-based summarization and theme extraction
- Sentiment breakdown with source attribution
- Claim extraction + cross-verification against independent sources
- Streaming progress updates during research
- User auth + saved report history

### 4.3 Stretch Features (v2+)
- Scheduled/recurring research ("track this topic weekly")
- Shareable public report links
- Comparison mode ("Product A vs Product B")
- Multi-language source support
- Browser extension version

---

## 5. Functional Requirements

### 5.1 Query Planning
- System must parse the user query and determine:
  - Topic type (product, policy/news, general topic, person, event)
  - Relevant source platforms for that topic type
  - Sub-queries optimized per platform (e.g., Reddit query differs from a YouTube search query)
- Must use structured LLM output (not free text) to make routing decisions machine-actionable.

### 5.2 Data Fetching
- Must fetch from all selected sources in parallel, not sequentially.
- Must enforce a timeout per source (e.g., 15s) so one slow/failing source doesn't block the whole pipeline.
- Must normalize all fetched content into a common schema before further processing:
  ```
  { source, source_type, author, text, url, timestamp, engagement_metrics }
  ```
- Must respect each platform's rate limits and terms of use.

### 5.3 Summarization & Insight Generation
- Must chunk and embed fetched text, store in vector DB (pgvector).
- Must retrieve relevant chunks per identified sub-theme within the topic.
- Must generate a structured summary containing:
  - Overall sentiment distribution (%)
  - Key themes/clusters (e.g., "battery life," "build quality") with sentiment per theme
  - Representative quotes with source links (not fabricated — must be traceable to fetched data)
- Must NOT hallucinate sources or quotes — every claim in the output must be traceable to a stored source record.

### 5.4 Cross-Verification
- Must extract the top N (3-5) most-repeated factual claims from the aggregated opinions.
- Must independently search news/fact-check sources for each claim.
- Must label each claim: Verified / Disputed / Unverified / Inconclusive, with the source used for verification.

### 5.5 Progress Streaming
- Backend must emit progress events (source fetch started/completed/failed, summarization started, verification started) via SSE/WebSocket.
- Frontend must render these as a live status list during processing.

### 5.6 User Management
- Users can sign up/log in (email + password or OAuth).
- Users can view history of past research reports.
- Users can re-run or delete past reports.

---

## 6. Non-Functional Requirements

| Category | Requirement |
|---|---|
| Performance | End-to-end report generation should complete in under 60 seconds for a standard query (excluding Amazon/Flipkart scraping, which may run separately/async) |
| Resilience | Pipeline must complete and return a partial report even if 1+ sources fail |
| Scalability | Fetching and LLM calls must be queued (not blocking HTTP requests) to handle concurrent users |
| Data integrity | Every claim/quote in a report must be traceable to a stored raw source record (no hallucinated attribution) |
| Cost control | LLM and embedding calls should be cached per query (avoid re-processing identical queries within a time window) |
| Transparency | UI must always show which sources contributed to a given report |

---

## 7. System Architecture (Summary)

```
React (Frontend)
   ↓ REST + SSE
Express/Node.js (API Gateway: auth, queueing, Postgres writes)
   ↓ internal service call
FastAPI + LangGraph (AI Orchestration Pipeline)
   ↓                              ↓
Data Fetchers                pgvector (Postgres)
(Reddit/YouTube/Wiki/News)        ↓
   ↓                         RAG Retrieval
Normalize → Embed  →   Summarization Agent (LLM)
                              ↓
                   Cross-Verification Agent (LLM + News Search)
                              ↓
                   Structured JSON Report → Postgres → React
```

**Core stack:** React.js, Node.js/Express, FastAPI, LangGraph, LangChain, PostgreSQL + pgvector, Redis + BullMQ (job queue), Docker.

---

## 8. Success Metrics (for a portfolio project, framed as if production)

- Report generation success rate (% of queries that return a complete report without critical failure)
- Average end-to-end latency
- Source fetch failure rate per platform
- Claim verification coverage (% of extracted claims successfully checked against an independent source)
- (If deployed publicly) number of unique queries run, user retention on saved reports

---

## 9. Risks & Open Questions

| Risk | Mitigation |
|---|---|
| Amazon/Flipkart actively block scraping | Treat as optional/pluggable source; consider a paid scraping API (ScraperAPI/Bright Data) or drop from MVP demo |
| Platform API rate limits (Reddit, YouTube) | Implement caching + backoff; cache identical queries for a time window |
| LLM hallucination in summaries | Enforce structured output + strict "only summarize retrieved chunks" prompting; every claim must cite a source ID |
| Cost of LLM/embedding calls at scale | Cache aggressively; use smaller/cheaper models for routing decisions, reserve stronger models for final synthesis |
| Legal/ToS concerns with scraping | Clearly document in README which sources use official APIs vs. scraping, and rate-limit/scrape responsibly for a portfolio project |
| Verification source itself being biased/wrong | Show verification source transparently rather than presenting it as absolute truth; label as "best-effort verification," not a fact court |

---

## 10. Milestones (Suggested Build Order)

1. **M1:** Postgres schema + Express CRUD (users, queries, reports) — no AI yet
2. **M2:** FastAPI + LangGraph skeleton with one source (Wikipedia)
3. **M3:** Add pgvector embedding + retrieval + basic summarization
4. **M4:** Add Reddit + YouTube sources in parallel; add graceful degradation
5. **M5:** Add cross-verification agent (news/fact-check)
6. **M6:** Add SSE progress streaming to React UI
7. **M7:** Add Amazon/Flipkart scraping as an optional source
8. **M8:** Polish, deploy (Docker + Railway/Render), write README/case study for resume

---

## 11. Appendix: Report Output Schema (Example)

```json
{
  "query": "Is the iPhone 16 battery life good?",
  "sources_used": ["reddit", "youtube", "news"],
  "sources_failed": ["amazon"],
  "sentiment_summary": {
    "positive": 62,
    "negative": 28,
    "neutral": 10
  },
  "themes": [
    {
      "theme": "Battery life under heavy use",
      "sentiment": "mixed",
      "representative_quotes": [
        {"text": "...", "source": "reddit", "url": "..."}
      ]
    }
  ],
  "verified_claims": [
    {
      "claim": "iPhone 16 lasts 20+ hours on a single charge",
      "status": "disputed",
      "verification_source": "https://...",
      "explanation": "..."
    }
  ]
}
```