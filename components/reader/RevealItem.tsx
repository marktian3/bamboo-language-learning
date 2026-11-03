'use client';

import React from 'react';
import { type Mark, type GlossItem, type Word } from '@/lib/db';
import { Volume2, AlertCircle } from 'lucide-react';
import { speakChinese } from '@/lib/tts/speak';
import { parsePinyinSyllables, getToneColor } from '@/lib/dict/pinyin';
import { cn } from '@/lib/utils';

interface RevealItemProps {
  mark: Mark;
  passageText: string;
  glossItem?: GlossItem | null;
  existingWord?: Word | null;
  isSelected: boolean;
  onSelect: () => void;
  onToggleAddToBank: (checked: boolean) => void;
  onApplySegmentation?: (suggested: string) => void;
  onHover: (hovered: boolean) => void;
  toneColorsEnabled: boolean;
  ttsVoice?: string;
  ttsSpeed?: number;
}

export function RevealItem({
  mark,
  passageText,
  glossItem,
  existingWord,
  isSelected,
  onSelect,
  onToggleAddToBank,
  onApplySegmentation,
  onHover,
  toneColorsEnabled,
  ttsVoice,
  ttsSpeed,
}: RevealItemProps) {
  // Extract snippet around word (<= 40 chars)
  const snippetStart = Math.max(0, mark.start - 18);
  const snippetEnd = Math.min(passageText.length, mark.end + 18);
  const prefix = passageText.slice(snippetStart, mark.start);
  const suffix = passageText.slice(mark.end, snippetEnd);

  const handlePlayAudio = (e: React.MouseEvent) => {
    e.stopPropagation();
    speakChinese(mark.surface, { voiceName: ttsVoice, rate: ttsSpeed });
  };

  const pinyinStr = glossItem?.pinyin || mark.surface;
  const syllables = parsePinyinSyllables(pinyinStr);

  const isName = glossItem?.type === 'name';
  const addToBankChecked = mark.addToBank ?? !isName;

  return (
    <div
      onClick={onSelect}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      className={cn(
        'p-4 rounded-xl border transition-all text-xs space-y-3 bg-[var(--surface)] cursor-pointer',
        isSelected ? 'border-[var(--primary)] ring-1 ring-[var(--primary)] shadow-sm' : 'border-[var(--border)]',
        'hover:border-[var(--primary)]/50'
      )}
    >
      {/* Header: Word & Add to Bank Checkbox */}
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <span className="font-serif text-2xl font-bold text-[var(--ink)]">
              {mark.surface}
            </span>
            {existingWord && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--primary-tint)] text-[var(--primary)] font-semibold">
                In bank · seen {existingWord.encounters || 1}×
              </span>
            )}
            {glossItem?.isDictionaryFallback && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--peek-bg)] text-[var(--peek)] font-semibold">
                dictionary
              </span>
            )}
          </div>
          <p className="text-xs text-[var(--ink-muted)] line-clamp-1 italic">
            &ldquo;{snippetStart > 0 ? '…' : ''}
            {prefix}
            <span className="font-bold text-[var(--mark)]">{mark.surface}</span>
            {suffix}
            {snippetEnd < passageText.length ? '…' : ''}&rdquo;
          </p>
        </div>

        <label
          onClick={e => e.stopPropagation()}
          className="flex items-center gap-1.5 cursor-pointer text-xs font-medium text-[var(--ink)] select-none shrink-0"
        >
          <input
            type="checkbox"
            checked={addToBankChecked}
            onChange={e => onToggleAddToBank(e.target.checked)}
            className="rounded accent-[var(--primary)] w-4 h-4 cursor-pointer"
          />
          <span>{existingWord ? 'Review sooner' : 'Add to Bank'}</span>
        </label>
      </div>

      {/* Suggested Segmentation Banner */}
      {glossItem?.segmentation && !glossItem.segmentation.ok && glossItem.segmentation.suggested && (
        <div
          onClick={e => e.stopPropagation()}
          className="p-2 rounded-lg bg-[var(--peek-bg)]/60 border border-[var(--peek)]/40 flex items-center justify-between gap-2 text-xs text-[var(--ink)]"
        >
          <span className="flex items-center gap-1">
            <AlertCircle className="w-3.5 h-3.5 text-[var(--peek)] shrink-0" />
            <span>Did you mean <strong>{glossItem.segmentation.suggested}</strong>?</span>
          </span>
          {onApplySegmentation && (
            <button
              onClick={() => onApplySegmentation(glossItem.segmentation!.suggested!)}
              className="px-2 py-0.5 rounded bg-[var(--primary)] text-white text-[11px] font-semibold hover:opacity-90"
            >
              Apply
            </button>
          )}
        </div>
      )}

      {/* Definition & Details */}
      <div className="space-y-3 pt-2 border-t border-[var(--border)]">
        {/* Pinyin and Audio */}
        <div className="flex items-center justify-between">
          <div className="flex flex-wrap gap-1 font-serif text-base font-semibold">
            {syllables.map((s, idx) => (
              <span
                key={idx}
                style={{
                  color: toneColorsEnabled ? getToneColor(s.tone) : 'var(--ink)',
                }}
              >
                {s.syllable}
              </span>
            ))}
          </div>
          <button
            onClick={handlePlayAudio}
            className="p-1 rounded text-[var(--ink-muted)] hover:text-[var(--primary)] hover:bg-[var(--surface-hover)]"
            title="Play pronunciation"
          >
            <Volume2 className="w-4 h-4" />
          </button>
        </div>

        {/* Short Gloss */}
        <div className="text-sm font-bold text-[var(--ink)] leading-snug">
          {glossItem?.gloss || 'Loading definition...'}
        </div>

        {/* In Context Explanation / Additional Senses */}
        {glossItem?.inContext && (
          <div className="text-xs text-[var(--ink)] leading-relaxed bg-[var(--bg)] p-2.5 rounded-lg border border-[var(--border)]">
            <span className="font-semibold text-[var(--ink-muted)]">
              {glossItem.isDictionaryFallback ? 'Also: ' : 'Here: '}
            </span>
            {glossItem.inContext}
          </div>
        )}

        {/* Per-character breakdown */}
        {glossItem?.breakdown && glossItem.breakdown.length > 0 && (
          <div className="flex flex-wrap gap-2 text-xs text-[var(--ink-muted)]">
            {glossItem.breakdown.map((b, idx) => (
              <span key={idx} className="flex items-center gap-1 bg-[var(--surface-hover)] px-2 py-0.5 rounded">
                <strong className="text-[var(--ink)] font-serif">{b.char}</strong>
                <span>{b.meaning}</span>
              </span>
            ))}
          </div>
        )}

        {/* Meta Chips: POS, Register, Type */}
        <div className="flex flex-wrap gap-1.5 text-[11px]">
          {glossItem?.pos && (
            <span className="px-2 py-0.5 rounded bg-[var(--surface-hover)] text-[var(--ink-muted)] font-medium">
              {glossItem.pos}
            </span>
          )}
          {glossItem?.register && (
            <span className="px-2 py-0.5 rounded bg-[var(--surface-hover)] text-[var(--ink-muted)] font-medium">
              {glossItem.register}
            </span>
          )}
          {glossItem?.type && (
            <span className="px-2 py-0.5 rounded bg-[var(--surface-hover)] text-[var(--ink-muted)] font-medium">
              {glossItem.type}
            </span>
          )}
        </div>

        {/* Note */}
        {glossItem?.note && (
          <p className="text-xs text-[var(--ink-muted)] italic leading-relaxed">
            Note: {glossItem.note}
          </p>
        )}
      </div>
    </div>
  );
}
