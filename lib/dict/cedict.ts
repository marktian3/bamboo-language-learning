import { db, type DictEntry, type GlossItem } from '@/lib/db';
import { getWordPinyin } from './pinyin';

const DICT_VERSION = '2';
const DICT_VERSION_KEY = '__version__';

let memoryDictFallback: Map<string, DictEntry> | null = null;
let initPromise: Promise<void> | null = null;

/**
 * Ensures the dictionary is populated in IndexedDB (`db.dict`) at the current DICT_VERSION.
 * Falls back to an in-memory Map only if IndexedDB is unavailable (e.g. SSR or test environments).
 */
export async function ensureDictionaryLoaded(): Promise<void> {
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      const versionEntry = await db.dict.get(DICT_VERSION_KEY);
      if (versionEntry?.pinyin === DICT_VERSION) {
        return;
      }
      await db.dict.clear();
    } catch {
      // IndexedDB unavailable; will use memoryDictFallback below
    }

    try {
      const res = await fetch('/dict/cedict.json');
      if (!res.ok) return;

      const raw = (await res.json()) as Record<string, { pinyin: string; definitions: string[] }>;
      const entriesToPersist: DictEntry[] = [];

      for (const [key, val] of Object.entries(raw)) {
        entriesToPersist.push({
          key,
          pinyin: val.pinyin,
          definitions: val.definitions,
        });
      }

      try {
        if (entriesToPersist.length > 0) {
          const CHUNK_SIZE = 10000;
          for (let i = 0; i < entriesToPersist.length; i += CHUNK_SIZE) {
            await db.dict.bulkPut(entriesToPersist.slice(i, i + CHUNK_SIZE));
          }
          await db.dict.put({
            key: DICT_VERSION_KEY,
            pinyin: DICT_VERSION,
            definitions: [],
          });
        }
      } catch {
        // IndexedDB write failed or unavailable; populate in-memory fallback
        const map = new Map<string, DictEntry>();
        for (const entry of entriesToPersist) {
          map.set(entry.key, entry);
        }
        memoryDictFallback = map;
      }
    } catch {
      // Ignore network fetch error
    }
  })();

  return initPromise;
}

export async function lookupDictionary(word: string): Promise<DictEntry | null> {
  await ensureDictionaryLoaded();

  try {
    const entry = await db.dict.get(word);
    if (entry) return entry;
  } catch {
    // IndexedDB unavailable
  }

  return memoryDictFallback?.get(word) || null;
}

/**
 * Checks which candidate words exist in the dictionary in a single batch query.
 */
export async function filterValidDictionaryWords(candidates: string[]): Promise<Set<string>> {
  if (candidates.length === 0) return new Set();
  await ensureDictionaryLoaded();

  const unique = Array.from(new Set(candidates));
  const valid = new Set<string>();

  try {
    const entries = await db.dict.bulkGet(unique);
    for (const entry of entries) {
      if (entry) valid.add(entry.key);
    }
    if (valid.size > 0 || !memoryDictFallback) {
      return valid;
    }
  } catch {
    // IndexedDB unavailable; fall back to memoryDictFallback
  }

  if (memoryDictFallback) {
    for (const word of unique) {
      if (memoryDictFallback.has(word)) {
        valid.add(word);
      }
    }
  }

  return valid;
}

/**
 * Builds a dictionary fallback gloss item for a word (§7.5)
 */
export async function buildDictionaryFallbackGloss(
  word: string,
  sentence?: string
): Promise<GlossItem> {
  const entry = await lookupDictionary(word);

  const wordPinyin = getWordPinyin(word, sentence);
  const gloss = entry && entry.definitions.length > 0
    ? entry.definitions[0]
    : 'definition unavailable';

  const breakdown: { char: string; meaning: string }[] = [];
  for (const char of word) {
    const charEntry = await lookupDictionary(char);
    breakdown.push({
      char,
      meaning: charEntry && charEntry.definitions.length > 0
        ? charEntry.definitions[0]
        : 'character',
    });
  }

  const extraDefs = entry && entry.definitions.length > 1
    ? entry.definitions.slice(1, 3).join('; ')
    : undefined;

  return {
    word,
    pinyin: wordPinyin,
    gloss,
    inContext: extraDefs,
    breakdown,
    isDictionaryFallback: true,
  };
}
