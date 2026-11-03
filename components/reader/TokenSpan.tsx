'use client';

import React from 'react';
import { type Token, type Mark, type GlossItem } from '@/lib/db';
import { parsePinyinSyllables, getToneColor } from '@/lib/dict/pinyin';
import { cn } from '@/lib/utils';

interface TokenSpanProps {
  token: Token;
  mark?: Mark;
  phase: 'pass1' | 'revealed' | 'pass2' | 'completed';
  isInWordBank?: boolean;
  isFocused?: boolean;
  isPanelHighlighted?: boolean;
  pinyinDisplay: 'off' | 'marked' | 'all';
  toneColorsEnabled: boolean;
  glossItem?: GlossItem | null;
  tokenPinyin?: string;
  onClick: (e: React.MouseEvent) => void;
  onKeyDown?: (e: React.KeyboardEvent) => void;
}

export const TokenSpan = React.forwardRef<HTMLSpanElement, TokenSpanProps>(
  function TokenSpan(
    {
      token,
      mark,
      phase,
      isInWordBank = false,
      isFocused = false,
      isPanelHighlighted = false,
      pinyinDisplay,
      toneColorsEnabled,
      tokenPinyin,
      onClick,
      onKeyDown,
    },
    ref
  ) {
    if (!token.isWord) {
      // Non-word punctuation or whitespace / Latin
      return <span className="select-text">{token.text}</span>;
    }

    const isMarked = Boolean(mark);
    const isPeeked = mark?.peek === 'pinyin' || mark?.peek === 'meaning';

    // In Pass 2 / completed, determine if ruby pinyin should be displayed
    const showRuby =
      (phase === 'pass2' || phase === 'completed') &&
      tokenPinyin &&
      (pinyinDisplay === 'all' || (pinyinDisplay === 'marked' && isMarked));

    const syllables = showRuby && tokenPinyin ? parsePinyinSyllables(tokenPinyin) : [];

    const content = showRuby ? (
      <ruby className="inline-flex flex-col items-center">
        <span>{token.text}</span>
        <rt className="select-none text-[0.44em] leading-none mb-0.5 tracking-normal">
          {syllables.map((s, idx) => (
            <span
              key={idx}
              style={{
                color: toneColorsEnabled ? getToneColor(s.tone) : 'var(--ink-muted)',
              }}
            >
              {s.syllable}{idx < syllables.length - 1 ? ' ' : ''}
            </span>
          ))}
        </rt>
      </ruby>
    ) : (
      token.text
    );

    return (
      <span
        ref={ref}
        role="button"
        tabIndex={0}
        aria-pressed={isMarked}
        lang="zh-CN"
        onClick={onClick}
        onKeyDown={onKeyDown}
        style={{ textIndent: 0 }}
        className={cn(
          'relative inline-block cursor-pointer select-text transition-colors duration-150 rounded px-0.5 mx-[0.5px] -my-1 py-1 focus:outline-none',
          // Hover state
          'hover:bg-[var(--surface-hover)]',
          // Marked state
          isMarked && !isPeeked && 'bg-[var(--mark-bg)] border-b-2 border-[var(--mark)]',
          // Peeked state
          isPeeked && 'bg-[var(--peek-bg)] border-b-2 border-dashed border-[var(--peek)]',
          // In Word Bank (not marked)
          isInWordBank && !isMarked && 'border-b border-dotted border-[var(--ink-faint)]',
          // Focus ring
          isFocused && 'ring-2 ring-[var(--focus)] ring-offset-1',
          // Panel highlight link
          isPanelHighlighted && 'ring-2 ring-[var(--mark)] ring-offset-2 animate-pulse'
        )}
      >
        {content}
      </span>
    );
  }
);
