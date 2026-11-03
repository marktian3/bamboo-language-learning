# Bamboo 竹

**Bamboo** is a local-first Mandarin Chinese reading and spaced-repetition (SRS) web application designed around **infer-first reading**: read uninterrupted first, mark unfamiliar words in context, reveal definitions and character breakdowns, re-read with pinyin support, and review vocabulary using the FSRS algorithm anchored to the exact sentences where you encountered each word.

---

## Features

- **Two-Pass Reading Flow**
  - **Pass 1 (Read & Mark)**: Read Chinese passages without distractions. Tap or drag across characters to mark unfamiliar words, extend/split word boundaries, or peek at pinyin.
  - **Reveal**: View pinyin (with optional tone coloring), audio pronunciation (TTS), character-by-character breakdowns, and definitions for all marked words.
  - **Pass 2 (Re-read)**: Re-read the passage with inline `<ruby>` pinyin above marked words, on-demand sentence translations, and sentence-by-sentence read-aloud audio.
- **Offline-First Dictionary + Optional AI Context**
  - Ships with a complete offline **CC-CEDICT** dictionary cached locally in IndexedDB for instant zero-latency lookups without an internet connection or API key.
  - Optionally connect a **DeepSeek** (or OpenAI-compatible) API key in Settings for passage-aware contextual definitions, segmentation suggestions, and inline sentence translations.
- **Context-Anchored Spaced Repetition (FSRS)**
  - Powered by [`ts-fsrs`](https://github.com/open-spaced-repetition/ts-fsrs) with configurable target retention and daily limits.
  - Every flashcard preserves the original sentence context from the passage where you encountered the word.
- **100% Local-First & Private**
  - All passages, marks, vocabulary, and review logs live locally in your browser's IndexedDB (via Dexie.js).
  - Full JSON database backup/restore and Anki/Pleco-friendly CSV export.

---

## Tech Stack

- **Framework**: [Next.js 16](https://nextjs.org/) (App Router) + [React 19](https://react.dev/) + TypeScript
- **Styling**: [Tailwind CSS v4](https://tailwindcss.com/) + Radix UI primitives
- **Local Storage**: [Dexie.js 4](https://dexie.org/) (IndexedDB)
- **Spaced Repetition**: [`ts-fsrs`](https://github.com/open-spaced-repetition/ts-fsrs) (FSRS v5)
- **Chinese NLP & Pinyin**: Native `Intl.Segmenter('zh-CN')`, [`pinyin-pro`](https://github.com/zh-lx/pinyin-pro), and CC-CEDICT
- **Testing**: [Vitest](https://vitest.dev/)

---

## Getting Started

### Prerequisites

- **Node.js** 20+ and **npm**

### 1. Install dependencies

```bash
npm install
```

### 2. Run the development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser. A sample passage (*《背影》* by Zhu Ziqing) is preloaded so you can try the reader immediately.

### 3. Optional: Configure AI Contextual Glosses

The app works out of the box using the built-in offline CC-CEDICT dictionary. To enable contextual AI explanations and sentence translations:
1. Open [http://localhost:3000/settings](http://localhost:3000/settings).
2. Enter a DeepSeek API key (or any OpenAI-compatible API key and base URL).
3. Click **Test Connection** to verify.

---

## Available Scripts

| Command | Description |
| :--- | :--- |
| `npm run dev` | Start the local Next.js development server on port 3000 |
| `npm run build` | Build the production application |
| `npm run start` | Start the production server |
| `npm run test` | Run the Vitest unit test suite |
| `npm run lint` | Run ESLint across the codebase |
| `npm run build:dict` | Re-download and compile CC-CEDICT into `public/dict/cedict.json` |
