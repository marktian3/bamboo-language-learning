import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { buildDictionaryFallbackGloss } from '@/lib/dict/cedict';

describe('CC-CEDICT Offline Dictionary', () => {
  it('public/dict/cedict.json exists and contains full CC-CEDICT vocabulary', () => {
    const dictPath = path.resolve(process.cwd(), 'public/dict/cedict.json');
    expect(fs.existsSync(dictPath)).toBe(true);

    const content = fs.readFileSync(dictPath, 'utf-8');
    const dict = JSON.parse(content);
    const wordCount = Object.keys(dict).length;

    // Full CC-CEDICT should have over 100,000 entries
    expect(wordCount).toBeGreaterThan(100000);

    // Common everyday words must be present
    expect(dict['我']).toBeDefined();
    expect(dict['我'].definitions[0]).toContain('I');

    expect(dict['你']).toBeDefined();
    expect(dict['好']).toBeDefined();
    expect(dict['落实']).toBeDefined();
    expect(dict['效率']).toBeDefined();

    // Metadata senses like CL: and "also pr." should be stripped from definitions
    expect(dict['父亲']).toBeDefined();
    expect(dict['父亲'].definitions).toContain('father');
    expect(dict['父亲'].definitions.some((d: string) => d.startsWith('CL:'))).toBe(false);
    expect(dict['父亲'].definitions.some((d: string) => d.includes('also pr.'))).toBe(false);
  });

  it('buildDictionaryFallbackGloss correctly resolves definition and breakdown', async () => {
    const gloss = await buildDictionaryFallbackGloss('落实');
    expect(gloss.word).toBe('落实');
    expect(gloss.pinyin).toBe('luò shí');
    expect(gloss.gloss).toBe('to implement');
    expect(gloss.isDictionaryFallback).toBe(true);
    expect(gloss.breakdown).toHaveLength(2);
    expect(gloss.breakdown[0].char).toBe('落');
    expect(gloss.breakdown[1].char).toBe('实');

    const woGloss = await buildDictionaryFallbackGloss('我');
    expect(woGloss.word).toBe('我');
    expect(woGloss.pinyin).toBe('wǒ');
    expect(woGloss.gloss).toContain('I');
  });
});
