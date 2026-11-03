import { type Token } from '@/lib/db';
import { splitSentences } from './sentences';
import { filterValidDictionaryWords } from '@/lib/dict/cedict';

const CJK_REGEX = /[\u4e00-\u9fa5\u3400-\u4dbf\uf900-\ufaff]/;

export interface Segmenter {
  segment(
    text: string,
    merges?: { start: number; end: number }[],
    validWords?: ReadonlySet<string>
  ): Token[];
}

export class IntlChineseSegmenter implements Segmenter {
  private segmenter: Intl.Segmenter;

  constructor() {
    this.segmenter = new Intl.Segmenter('zh-CN', { granularity: 'word' });
  }

  segment(
    text: string,
    merges: { start: number; end: number }[] = [],
    validWords?: ReadonlySet<string>
  ): Token[] {
    if (!text) return [];

    const sentences = splitSentences(text);

    // Helper to find sentence and paragraph for a character offset
    const findLocation = (offset: number): { sentenceIdx: number; paragraphIdx: number } => {
      for (const s of sentences) {
        if (offset >= s.start && offset < s.end) {
          return { sentenceIdx: s.index, paragraphIdx: s.paragraphIdx };
        }
      }
      const last = sentences[sentences.length - 1];
      return {
        sentenceIdx: last ? last.index : 0,
        paragraphIdx: last ? last.paragraphIdx : 0,
      };
    };

    // Base segmentation using Intl.Segmenter
    const rawTokens: Token[] = [];
    const segments = this.segmenter.segment(text);

    for (const seg of segments) {
      const segText = seg.segment;
      const start = seg.index;
      const end = start + segText.length;
      const isWord = Boolean(seg.isWordLike && CJK_REGEX.test(segText));
      const loc = findLocation(start);

      rawTokens.push({
        id: `t_${start}_${end}`,
        text: segText,
        start,
        end,
        isWord,
        sentenceIdx: loc.sentenceIdx,
        paragraphIdx: loc.paragraphIdx,
      });
    }

    // Refine tokens against dictionary if validWords set is provided
    const baseTokens: Token[] = validWords
      ? this.refineWithDictionary(text, rawTokens, validWords, findLocation)
      : rawTokens;

    if (!merges || merges.length === 0) {
      return baseTokens;
    }

    // Apply user boundary overrides (merges)
    // Sort merges by start offset
    const sortedMerges = [...merges].sort((a, b) => a.start - b.start);
    const resultTokens: Token[] = [];
    let i = 0;

    while (i < baseTokens.length) {
      const currentToken = baseTokens[i];

      // Check if currentToken starts or is within an active merge
      const activeMerge = sortedMerges.find(
        m => m.start <= currentToken.start && currentToken.end <= m.end
      );

      if (activeMerge && currentToken.start === activeMerge.start) {
        // Collect all tokens within this merge
        const mergedTextParts: string[] = [];
        let mergedEnd = currentToken.end;
        let isWord = false;
        const start = currentToken.start;
        const sentenceIdx = currentToken.sentenceIdx;
        const paragraphIdx = currentToken.paragraphIdx;

        while (i < baseTokens.length && baseTokens[i].end <= activeMerge.end) {
          mergedTextParts.push(baseTokens[i].text);
          mergedEnd = baseTokens[i].end;
          if (baseTokens[i].isWord) isWord = true;
          i++;
        }

        const mergedText = text.slice(start, mergedEnd);
        resultTokens.push({
          id: `t_${start}_${mergedEnd}`,
          text: mergedText,
          start,
          end: mergedEnd,
          isWord: isWord || CJK_REGEX.test(mergedText),
          sentenceIdx,
          paragraphIdx,
        });
      } else {
        resultTokens.push(currentToken);
        i++;
      }
    }

    return resultTokens;
  }

  /**
   * Repairs multi-character tokens from Intl.Segmenter that do not exist in CC-CEDICT
   * by re-segmenting the invalid token and its adjacent 1-character CJK neighbors
   * using forward maximum matching against valid dictionary words.
   */
  private refineWithDictionary(
    text: string,
    tokens: Token[],
    validWords: ReadonlySet<string>,
    findLocation: (offset: number) => { sentenceIdx: number; paragraphIdx: number }
  ): Token[] {
    const isInvalidMultiChar = (t: Token) =>
      t.isWord && t.text.length > 1 && !validWords.has(t.text);

    // Mark which token indices need repair (invalid multi-char tokens + adjacent 1-char CJK tokens in same sentence)
    const repairMask = new Array<boolean>(tokens.length).fill(false);
    for (let i = 0; i < tokens.length; i++) {
      if (isInvalidMultiChar(tokens[i])) {
        repairMask[i] = true;
        if (
          i > 0 &&
          tokens[i - 1].isWord &&
          tokens[i - 1].text.length === 1 &&
          tokens[i - 1].sentenceIdx === tokens[i].sentenceIdx
        ) {
          repairMask[i - 1] = true;
        }
        if (
          i + 1 < tokens.length &&
          tokens[i + 1].isWord &&
          tokens[i + 1].text.length === 1 &&
          tokens[i + 1].sentenceIdx === tokens[i].sentenceIdx
        ) {
          repairMask[i + 1] = true;
        }
      }
    }

    const refined: Token[] = [];
    let i = 0;
    while (i < tokens.length) {
      if (!repairMask[i]) {
        refined.push(tokens[i]);
        i++;
        continue;
      }

      // Collect contiguous repair span within the same sentence
      const spanStart = tokens[i].start;
      const sentenceIdx = tokens[i].sentenceIdx;
      let spanEnd = tokens[i].end;
      i++;
      while (
        i < tokens.length &&
        repairMask[i] &&
        tokens[i].sentenceIdx === sentenceIdx &&
        tokens[i].start === spanEnd
      ) {
        spanEnd = tokens[i].end;
        i++;
      }

      // Forward maximum matching (4 -> 3 -> 2 -> 1 chars) over [spanStart, spanEnd)
      let pos = spanStart;
      while (pos < spanEnd) {
        let matchedEnd = pos + 1;
        for (const len of [4, 3, 2]) {
          if (pos + len <= spanEnd) {
            const candidate = text.slice(pos, pos + len);
            if (validWords.has(candidate)) {
              matchedEnd = pos + len;
              break;
            }
          }
        }
        const subText = text.slice(pos, matchedEnd);
        const loc = findLocation(pos);
        refined.push({
          id: `t_${pos}_${matchedEnd}`,
          text: subText,
          start: pos,
          end: matchedEnd,
          isWord: CJK_REGEX.test(subText),
          sentenceIdx: loc.sentenceIdx,
          paragraphIdx: loc.paragraphIdx,
        });
        pos = matchedEnd;
      }
    }

    return refined;
  }
}

export const defaultSegmenter = new IntlChineseSegmenter();

export function segmentText(
  text: string,
  merges?: { start: number; end: number }[],
  validWords?: ReadonlySet<string>
): Token[] {
  return defaultSegmenter.segment(text, merges, validWords);
}

/**
 * Segments Chinese text and validates multi-character tokens against CC-CEDICT
 * so non-dictionary chunks (like "不相" in "不相见") are re-aligned to valid dictionary words ("不" + "相见").
 */
export async function segmentTextWithDictionary(
  text: string,
  merges: { start: number; end: number }[] = []
): Promise<Token[]> {
  if (!text) return [];

  // Collect candidate 2..4 char CJK substrings in text
  const candidates: string[] = [];
  for (let i = 0; i < text.length; i++) {
    if (!CJK_REGEX.test(text[i])) continue;
    for (const len of [2, 3, 4]) {
      if (i + len <= text.length) {
        const sub = text.slice(i, i + len);
        if (CJK_REGEX.test(sub[sub.length - 1])) {
          candidates.push(sub);
        }
      }
    }
  }

  const validWords = await filterValidDictionaryWords(candidates);
  if (validWords.size === 0) {
    return defaultSegmenter.segment(text, merges);
  }

  return defaultSegmenter.segment(text, merges, validWords);
}
