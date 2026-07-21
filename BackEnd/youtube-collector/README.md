# YouTube Knowledge Collector

A production-quality Node.js CLI that searches YouTube, fetches structured video metadata + full transcripts, cleans them, auto-translates non-English transcripts, and saves everything as structured JSON ready to feed into an LLM.

---

## Setup

### 1. Install dependencies

```bash
cd youtube-collector
npm install
```

### 2. Get a free YouTube Data API v3 key

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or select an existing one)
3. Navigate to **APIs & Services → Library**
4. Search for **YouTube Data API v3** and click **Enable**
5. Go to **APIs & Services → Credentials**
6. Click **Create Credentials → API Key**
7. Copy the generated key

> The free quota is **10,000 units/day**. Each run of this tool uses approximately **150 units**, so you can run it ~66 times per day for free.

### 3. Create your `.env` file

```bash
cp .env.example .env
```

Open `.env` and replace `your_youtube_api_key_here` with your actual key:

```
YOUTUBE_API_KEY=AIzaSy...
```

---

## Run

```bash
npm start
```

You will be prompted to enter your search query in the terminal:

```
Enter your YouTube search query: Best phone under 20000
```

---

## Output

Results are saved to `youtube-results.json` in the project directory.

```json
{
  "query": "Best phone under 20000",
  "videos": [
    {
      "videoId": "...",
      "title": "...",
      "channel": "...",
      "publishedAt": "...",
      "views": 1200000,
      "likes": 45000,
      "duration": "12:34",
      "url": "https://www.youtube.com/watch?v=...",
      "thumbnail": "...",
      "description": "...",
      "transcript": {
        "language": "en",
        "original": "...",
        "english": "..."
      }
    }
  ]
}
```

---

## Project Structure

```
youtube-collector/
├── src/
│   ├── search.js       → searchVideos()       — YouTube Data API search
│   ├── metadata.js     → getVideoMetadata()   — Batch metadata + ranking
│   ├── cleaner.js      → cleanDescription()   — Strip promotional content
│   │                   → cleanTranscript()    — Deduplicate caption lines
│   ├── transcript.js   → getTranscript()      — Fetch captions
│   ├── translator.js   → translateTranscript()— Detect language & translate
│   └── output.js       → saveJson()           — Write JSON file
├── main.js             → main()               — CLI orchestrator
├── package.json
├── .env.example
└── README.md
```
