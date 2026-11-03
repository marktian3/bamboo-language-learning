import { describe, it, expect } from 'vitest';
import { splitSentences } from '@/lib/segment/sentences';
import { IntlChineseSegmenter } from '@/lib/segment/segmenter';

describe('Sentence Splitter', () => {
  it('splits on Chinese punctuation (。, ！, ？, ；)', () => {
    const text = '你好！这是第一句。这是第二句？还有第三句；结束了。';
    const sentences = splitSentences(text);
    expect(sentences).toHaveLength(5);
    expect(sentences[0].text).toBe('你好！');
    expect(sentences[1].text).toBe('这是第一句。');
    expect(sentences[2].text).toBe('这是第二句？');
    expect(sentences[3].text).toBe('还有第三句；');
    expect(sentences[4].text).toBe('结束了。');
  });

  it('keeps trailing closing quotes and brackets with the sentence', () => {
    const text = '他说：“中国很美。”我也赞同（确实）。';
    const sentences = splitSentences(text);
    expect(sentences).toHaveLength(2);
    expect(sentences[0].text).toBe('他说：“中国很美。”');
    expect(sentences[1].text).toBe('我也赞同（确实）。');
  });

  it('handles Chinese ellipsis …… and standard dots ...', () => {
    const text = '等一下……你刚才说什么？我不知道...';
    const sentences = splitSentences(text);
    expect(sentences).toHaveLength(3);
    expect(sentences[0].text).toBe('等一下……');
    expect(sentences[1].text).toBe('你刚才说什么？');
    expect(sentences[2].text).toBe('我不知道...');
  });

  it('handles empty lines and paragraph boundaries correctly', () => {
    const text = '第一段。\n\n第二段第一句。第二段第二句。\n';
    const sentences = splitSentences(text);
    expect(sentences).toHaveLength(3);
    expect(sentences[0].paragraphIdx).toBe(0);
    expect(sentences[1].paragraphIdx).toBe(2);
    expect(sentences[2].paragraphIdx).toBe(2);
  });

  it('preserves accurate character offsets', () => {
    const text = '今天天气好。我们去公园吧！';
    const sentences = splitSentences(text);
    for (const s of sentences) {
      expect(text.slice(s.start, s.end)).toBe(s.text);
    }
  });
});

describe('IntlChineseSegmenter', () => {
  const segmenter = new IntlChineseSegmenter();

  it('marks CJK words as isWord=true, punctuation as isWord=false', () => {
    const text = '随着人工智能技术的迅速发展，越来越多的企业开始落实自动化。';
    const tokens = segmenter.segment(text);
    
    // Check that Chinese words have isWord=true
    const wordTokens = tokens.filter(t => t.isWord);
    expect(wordTokens.length).toBeGreaterThan(0);
    expect(wordTokens.some(t => t.text === '人工智能' || t.text === '人工' || t.text === '技术')).toBe(true);

    // Check punctuation has isWord=false
    const commaToken = tokens.find(t => t.text === '，');
    expect(commaToken?.isWord).toBe(false);

    const periodToken = tokens.find(t => t.text === '。');
    expect(periodToken?.isWord).toBe(false);
  });

  it('handles mixed Latin/numbers and marks them isWord=false', () => {
    const text = 'Bamboo 2.0 在 2026 年发布。';
    const tokens = segmenter.segment(text);
    const latinToken = tokens.find(t => t.text === 'Bamboo');
    expect(latinToken?.isWord).toBe(false);

    const numToken = tokens.find(t => t.text === '2026');
    expect(numToken?.isWord).toBe(false);

    const yearToken = tokens.find(t => t.text === '年');
    expect(yearToken?.isWord).toBe(true);
  });

  it('applies user boundary overrides (merges)', () => {
    const text = '落实自动化作为提高效率的重要手段。';
    // Let's merge "落实" and "自动化" into one token
    const baseTokens = segmenter.segment(text);
    const luoshi = baseTokens.find(t => t.text === '落实');
    expect(luoshi).toBeDefined();

    if (luoshi) {
      const start = luoshi.start;
      const end = start + 5; // "落实自动化" is 5 chars
      const mergedTokens = segmenter.segment(text, [{ start, end }]);
      const combined = mergedTokens.find(t => t.text === '落实自动化');
      expect(combined).toBeDefined();
      expect(combined?.isWord).toBe(true);
      expect(combined?.start).toBe(start);
      expect(combined?.end).toBe(end);
    }
  });

  it('repairs non-dictionary multi-character chunks using valid dictionary words', () => {
    const text = '我与父亲不相见已二年余了';
    const validWords = new Set(['父亲', '相见']);
    const tokens = segmenter.segment(text, [], validWords);
    const tokenTexts = tokens.map(t => t.text);

    // "父亲" stays grouped, while "不相" + "见" is repaired to "不" + "相见", and "二年" is split into "二" + "年"
    expect(tokenTexts).toContain('父亲');
    expect(tokenTexts).not.toContain('不相');
    expect(tokenTexts).toContain('不');
    expect(tokenTexts).toContain('相见');
    expect(tokenTexts).not.toContain('二年');
    expect(tokenTexts).toContain('二');
    expect(tokenTexts).toContain('年');
  });
});
