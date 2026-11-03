'use client';

import React, { useEffect, useState, useRef, useMemo } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { db, getSettings, updateSettings, type Passage, type Mark, type Token, type GlossItem, type AppSettings, type Word, type Context } from '@/lib/db';
import { ReaderHeader } from '@/components/reader/ReaderHeader';
import { TokenSpan } from '@/components/reader/TokenSpan';
import { MarkToolbar } from '@/components/reader/MarkToolbar';
import { RevealPanel } from '@/components/reader/RevealPanel';
import { SentenceTranslation } from '@/components/reader/SentenceTranslation';
import { FinishModal } from '@/components/reader/FinishModal';
import { fetchGlossesForMarks } from '@/lib/llm/client';
import { segmentTextWithDictionary } from '@/lib/segment/segmenter';
import { getWordPinyin } from '@/lib/dict/pinyin';
import { createNewCard } from '@/lib/srs/fsrs';
import { speakChinese, stopSpeaking } from '@/lib/tts/speak';
import { nanoid } from 'nanoid';
import { Play, Square, Check, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function ReaderPage() {
  const params = useParams();
  const passageId = params?.passageId as string;
  const router = useRouter();

  // Core state
  const [passage, setPassage] = useState<Passage | null>(null);
  const [marks, setMarks] = useState<Mark[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [glosses, setGlosses] = useState<Map<string, GlossItem>>(new Map());
  const [wordsMap, setWordsMap] = useState<Map<string, Word>>(new Map());
  const [activeToolbarTokenId, setActiveToolbarTokenId] = useState<string | null>(null);
  const [selectedPanelMarkId, setSelectedPanelMarkId] = useState<string | null>(null);
  const [hoveredMarkId, setHoveredMarkId] = useState<string | null>(null);
  const [isRevealOpen, setIsRevealOpen] = useState(false);
  const [showFinishModal, setShowFinishModal] = useState(false);

  // Read aloud (TTS) state
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const [currentSentenceIdx, setCurrentSentenceIdx] = useState<number | null>(null);

  // Token refs for positioning
  const tokenRefs = useRef<Map<string, HTMLSpanElement>>(new Map());
  const idleTimerRef = useRef<NodeJS.Timeout | null>(null);

  // 1. Load passage, marks, settings, and existing word bank
  useEffect(() => {
    async function loadData() {
      const p = await db.passages.get(passageId);
      if (!p) {
        router.push('/');
        return;
      }

      // Re-segment with dictionary validation so non-dictionary chunks are resolved
      const validatedTokens = await segmentTextWithDictionary(p.text, p.merges);
      const now = Date.now();
      await db.passages.update(passageId, { tokens: validatedTokens, lastOpenedAt: now });
      p.tokens = validatedTokens;
      p.lastOpenedAt = now;
      setPassage(p);

      const rawMarks = await db.marks.where('passageId').equals(passageId).toArray();
      const tokenByStart = new Map(validatedTokens.map(t => [t.start, t]));
      const syncedMarks: Mark[] = [];
      for (const mark of rawMarks) {
        const matchingToken = tokenByStart.get(mark.start);
        if (matchingToken && (matchingToken.end !== mark.end || matchingToken.text !== mark.surface)) {
          const updatedMark: Mark = {
            ...mark,
            end: matchingToken.end,
            surface: matchingToken.text,
          };
          await db.marks.update(mark.id, { end: matchingToken.end, surface: matchingToken.text });
          syncedMarks.push(updatedMark);
        } else {
          syncedMarks.push(mark);
        }
      }
      setMarks(syncedMarks);

      const s = await getSettings();
      setSettings(s);

      // Load words to check existing bank
      const allWords = await db.words.toArray();
      const map = new Map<string, Word>();
      for (const w of allWords) {
        map.set(w.simplified, w);
      }
      setWordsMap(map);

      // Open reveal panel if phase is revealed
      if (p.phase === 'revealed') {
        setIsRevealOpen(true);
      }

      // Restore scroll
      if (p.scrollY > 0) {
        window.scrollTo({ top: p.scrollY });
      }
    }
    loadData();

    return () => {
      stopSpeaking();
    };
  }, [passageId, router]);

  // Save scroll position on leave / scroll
  useEffect(() => {
    const handleScroll = () => {
      if (passage) {
        db.passages.update(passageId, { scrollY: window.scrollY });
      }
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [passage, passageId]);

  // Background prefetch (§6.3): when reveal is open fetch immediately; otherwise after 3s idle
  useEffect(() => {
    if (!passage || marks.length === 0) return;

    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    const delay = isRevealOpen ? 0 : 3000;
    idleTimerRef.current = setTimeout(async () => {
      try {
        const fetched = await fetchGlossesForMarks(passage, marks);
        setGlosses(prev => new Map([...prev, ...fetched]));
      } catch {
        // silent prefetch error
      }
    }, delay);

    return () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    };
  }, [passage, marks, isRevealOpen]);

  // Marks map by start offset for fast lookup
  const marksByStart = useMemo(() => {
    const map = new Map<number, Mark>();
    for (const m of marks) {
      map.set(m.start, m);
    }
    return map;
  }, [marks]);

  // Group tokens into sentences and paragraphs for structured reading layout
  const paragraphs = useMemo(() => {
    if (!passage) return [];
    const pMap = new Map<number, Token[]>();
    for (const t of passage.tokens) {
      const list = pMap.get(t.paragraphIdx) || [];
      list.push(t);
      pMap.set(t.paragraphIdx, list);
    }
    return Array.from(pMap.values());
  }, [passage]);

  // Mark / Unmark handlers
  const handleToggleMark = async (token: Token) => {
    if (!passage) return;
    const existing = marksByStart.get(token.start);

    if (existing) {
      // If already marked, open toolbar
      setActiveToolbarTokenId(token.id);
    } else {
      // Mark word
      const newMark: Mark = {
        id: nanoid(10),
        passageId: passage.id,
        start: token.start,
        end: token.end,
        surface: token.text,
        sentenceIdx: token.sentenceIdx,
        peek: 'none',
        addToBank: true,
        createdAt: Date.now(),
      };
      await db.marks.add(newMark);
      setMarks(prev => [...prev, newMark]);

      // If lookupStyle is instant, open toolbar immediately
      if (settings?.lookupStyle === 'instant') {
        setActiveToolbarTokenId(token.id);
      }
    }
  };

  const handleUnmark = async (markId: string) => {
    await db.marks.delete(markId);
    setMarks(prev => prev.filter(m => m.id !== markId));
    setActiveToolbarTokenId(null);
  };

  // Extend / Split user overrides (§6.2, §6.3)
  const handleExtend = async (mark: Mark, direction: 'left' | 'right') => {
    if (!passage) return;
    const tokens = passage.tokens;
    const tokenIdx = tokens.findIndex(t => t.start === mark.start);
    if (tokenIdx === -1) return;

    let newStart = mark.start;
    let newEnd = mark.end;

    if (direction === 'left' && tokenIdx > 0) {
      newStart = tokens[tokenIdx - 1].start;
    } else if (direction === 'right' && tokenIdx < tokens.length - 1) {
      newEnd = tokens[tokenIdx + 1].end;
    }

    const newSurface = passage.text.slice(newStart, newEnd);
    const newMerges = [...passage.merges, { start: newStart, end: newEnd }];
    const resegmented = await segmentTextWithDictionary(passage.text, newMerges);

    await db.transaction('rw', [db.passages, db.marks], async () => {
      await db.passages.update(passage.id, {
        tokens: resegmented,
        merges: newMerges,
        updatedAt: Date.now(),
      });
      await db.marks.update(mark.id, {
        start: newStart,
        end: newEnd,
        surface: newSurface,
      });
    });

    setPassage({ ...passage, tokens: resegmented, merges: newMerges });
    setMarks(prev =>
      prev.map(m => (m.id === mark.id ? { ...m, start: newStart, end: newEnd, surface: newSurface } : m))
    );
    setActiveToolbarTokenId(null);
  };

  const handleSplit = async (mark: Mark) => {
    if (!passage) return;
    // Remove merge overrides overlapping this mark
    const remainingMerges = passage.merges.filter(
      m => !(m.start >= mark.start && m.end <= mark.end)
    );
    const resegmented = await segmentTextWithDictionary(passage.text, remainingMerges);

    await db.transaction('rw', [db.passages, db.marks], async () => {
      await db.passages.update(passage.id, {
        tokens: resegmented,
        merges: remainingMerges,
        updatedAt: Date.now(),
      });
      await db.marks.delete(mark.id);
    });

    setPassage({ ...passage, tokens: resegmented, merges: remainingMerges });
    setMarks(prev => prev.filter(m => m.id !== mark.id));
    setActiveToolbarTokenId(null);
  };

  // Phase Transitions
  const handleTransitionToReveal = async () => {
    if (!passage) return;
    await db.passages.update(passage.id, { phase: 'revealed', status: 'revealed' });
    setPassage({ ...passage, phase: 'revealed', status: 'revealed' });
    setIsRevealOpen(true);

    // Fetch glosses for all marks
    const fetched = await fetchGlossesForMarks(passage, marks);
    setGlosses(prev => new Map([...prev, ...fetched]));
  };

  const handleTransitionToReRead = async () => {
    if (!passage) return;
    await db.passages.update(passage.id, { phase: 'pass2', status: 'pass2' });
    setPassage({ ...passage, phase: 'pass2', status: 'pass2' });
    setIsRevealOpen(false);
  };

  // Finish Reading & Persist Word Bank (§6.5, §6.6)
  const handleConfirmFinish = async () => {
    if (!passage) return;

    await db.transaction('rw', [db.passages, db.words, db.contexts, db.cards], async () => {
      const now = Date.now();

      for (const mark of marks) {
        if (!mark.addToBank) continue;

        const gloss = glosses.get(mark.id);
        const existing = await db.words.where('simplified').equals(mark.surface).first();

        let wordId = existing?.id;

        if (existing) {
          // Increment encounters
          await db.words.update(existing.id, {
            encounters: (existing.encounters || 1) + 1,
            updatedAt: now,
          });

          // Review sooner: set due to now
          const card = await db.cards.where('wordId').equals(existing.id).first();
          if (card) {
            await db.cards.update(card.id, { due: now });
          }
        } else {
          // Create new Word
          wordId = nanoid(10);
          const newWord: Word = {
            id: wordId,
            simplified: mark.surface,
            pinyin: gloss?.pinyin || getWordPinyin(mark.surface),
            gloss: gloss?.gloss || 'definition',
            breakdown: gloss?.breakdown || [],
            pos: gloss?.pos,
            register: gloss?.register,
            type: gloss?.type,
            note: gloss?.note,
            tags: [],
            status: 'active',
            encounters: 1,
            createdAt: now,
            updatedAt: now,
          };
          await db.words.add(newWord);

          // Create initial FSRS recognition card
          const card = createNewCard(wordId);
          await db.cards.add(card);
        }

        // Attach Context (deduplicated by wordId + passageId + sentenceIdx)
        if (wordId) {
          const existingCtx = await db.contexts
            .where('[wordId+passageId+sentenceIdx]')
            .equals([wordId, passage.id, mark.sentenceIdx])
            .first();

          if (!existingCtx) {
            // Find context sentence snippet
            const sentenceSnippet = passage.text.slice(
              Math.max(0, mark.start - 30),
              Math.min(passage.text.length, mark.end + 30)
            );

            const contextRecord: Context = {
              id: nanoid(10),
              wordId,
              passageId: passage.id,
              sentence: sentenceSnippet,
              sentenceIdx: mark.sentenceIdx,
              inContext: gloss?.inContext,
              createdAt: now,
            };
            await db.contexts.add(contextRecord);
          }
        }
      }

      // Mark passage completed
      await db.passages.update(passage.id, { phase: 'completed', status: 'completed' });
    });
  };

  // Read aloud TTS sentence by sentence
  const handleToggleReadAloud = () => {
    if (isPlayingAudio) {
      stopSpeaking();
      setIsPlayingAudio(false);
      setCurrentSentenceIdx(null);
      return;
    }

    if (!passage) return;
    setIsPlayingAudio(true);

    // Group text by sentences
    const lines = passage.text.split(/[。！？\n]+/).filter(s => s.trim().length > 0);
    let sIdx = 0;

    const playNext = () => {
      if (sIdx >= lines.length) {
        setIsPlayingAudio(false);
        setCurrentSentenceIdx(null);
        return;
      }
      setCurrentSentenceIdx(sIdx);
      speakChinese(lines[sIdx], {
        rate: settings?.ttsSpeed ?? 0.9,
        voiceName: settings?.ttsVoice,
        onEnd: () => {
          sIdx++;
          playNext();
        },
        onError: () => {
          setIsPlayingAudio(false);
          setCurrentSentenceIdx(null);
        },
      });
    };

    playNext();
  };

  if (!passage || !settings) {
    return (
      <div className="min-h-screen flex items-center justify-center text-[var(--ink-muted)]">
        Loading passage...
      </div>
    );
  }

  // Summary counts for finish modal
  const newWordsCount = marks.filter(m => m.addToBank && !wordsMap.has(m.surface)).length;
  const reviewSoonerCount = marks.filter(m => m.addToBank && wordsMap.has(m.surface)).length;

  return (
    <div className="min-h-screen flex flex-col bg-[var(--bg)] text-[var(--ink)]">
      {/* Slim Header */}
      <ReaderHeader
        passage={passage}
        settings={settings}
        onUpdateTitle={title => {
          db.passages.update(passage.id, { title });
          setPassage({ ...passage, title });
        }}
        onUpdateSettings={async (key, val) => {
          setSettings({ ...settings, [key]: val });
          await updateSettings({ [key]: val });
        }}
        onPhaseChange={phase => {
          db.passages.update(passage.id, { phase, status: phase });
          setPassage({ ...passage, phase, status: phase });
          if (phase === 'revealed') setIsRevealOpen(true);
        }}
      />

      {/* Main Reading Surface */}
      <div className="flex-1 flex justify-center px-4 sm:px-6 py-8 relative">
        <main
          className={cn(
            'w-full transition-all duration-200 ease-out',
            isRevealOpen ? 'lg:mr-[400px] max-w-[34em]' : 'max-w-[34em]'
          )}
          style={{
            fontSize: `${settings.fontSize}px`,
            lineHeight: settings.lineHeight === 'compact' ? 1.8 : settings.lineHeight === 'airy' ? 2.6 : 2.2,
            fontFamily:
              settings.fontFamily === 'LXGW WenKai'
                ? 'var(--font-wenkai)'
                : settings.fontFamily === 'Noto Sans SC'
                ? 'var(--font-noto-sans-sc)'
                : 'var(--font-noto-serif-sc)',
          }}
        >
          {paragraphs.map((tokensInPara, pIdx) => (
            <div
              key={pIdx}
              role="paragraph"
              className="mb-6 text-justify select-text relative"
              style={{ textIndent: '2em', letterSpacing: '0.04em' }}
            >
              {tokensInPara.map(token => {
                const mark = marksByStart.get(token.start);
                const isToolbarOpen = activeToolbarTokenId === token.id;
                const gloss = mark ? glosses.get(mark.id) : null;
                const tokenPinyin = gloss?.pinyin || getWordPinyin(token.text);
                const isSentencePlaying = currentSentenceIdx === token.sentenceIdx;

                return (
                  <span
                    key={token.id}
                    className={cn(
                      'relative inline',
                      isSentencePlaying && 'bg-[var(--surface-hover)] rounded'
                    )}
                  >
                    <TokenSpan
                      ref={el => {
                        if (el) tokenRefs.current.set(token.id, el);
                        else tokenRefs.current.delete(token.id);
                      }}
                      token={token}
                      mark={mark}
                      phase={passage.phase}
                      isInWordBank={settings.underlineWordBank && wordsMap.has(token.text)}
                      isPanelHighlighted={hoveredMarkId === mark?.id || selectedPanelMarkId === mark?.id}
                      pinyinDisplay={settings.pinyinDisplay}
                      toneColorsEnabled={settings.toneColors}
                      tokenPinyin={tokenPinyin}
                      onClick={() => handleToggleMark(token)}
                    />

                    {/* Mark Toolbar Popover */}
                    {isToolbarOpen && mark && (
                      <div className="absolute left-1/2 -translate-x-1/2 -top-11 z-50">
                        <MarkToolbar
                          mark={mark}
                          pinyinStr={tokenPinyin}
                          glossItem={gloss}
                          canExtendLeft={token.start > 0}
                          canExtendRight={token.end < passage.text.length}
                          canSplit={mark.end - mark.start > token.text.length}
                          onPeekPinyin={() => {
                            db.marks.update(mark.id, { peek: 'pinyin' });
                            setMarks(prev =>
                              prev.map(m => (m.id === mark.id ? { ...m, peek: 'pinyin' } : m))
                            );
                          }}
                          onPeekMeaning={() => {
                            db.marks.update(mark.id, { peek: 'meaning' });
                            setMarks(prev =>
                              prev.map(m => (m.id === mark.id ? { ...m, peek: 'meaning' } : m))
                            );
                          }}
                          onExtendLeft={() => handleExtend(mark, 'left')}
                          onExtendRight={() => handleExtend(mark, 'right')}
                          onSplit={() => handleSplit(mark)}
                          onUnmark={() => handleUnmark(mark.id)}
                          onClose={() => setActiveToolbarTokenId(null)}
                          toneColorsEnabled={settings.toneColors}
                          ttsVoice={settings.ttsVoice}
                          ttsSpeed={settings.ttsSpeed}
                        />
                      </div>
                    )}
                  </span>
                );
              })}

              {/* In Pass 2: Per-sentence translation icon */}
              {(passage.phase === 'pass2' || passage.phase === 'completed') && (
                <SentenceTranslation
                  sentenceText={tokensInPara.map(t => t.text).join('')}
                  passageContext={passage.text}
                />
              )}
            </div>
          ))}
        </main>
      </div>

      {/* Sticky Bottom Action Bar */}
      <footer className="sticky bottom-0 z-30 w-full border-t border-[var(--border)] bg-[var(--surface)]/95 backdrop-blur-md px-4 sm:px-6 py-3">
        <div className="max-w-4xl mx-auto flex items-center justify-between gap-4">
          {passage.phase === 'pass1' ? (
            <>
              <div className="text-xs sm:text-sm text-[var(--ink-muted)]">
                <span className="font-bold text-[var(--ink)]">{marks.length}</span> words marked ·{' '}
                <span>{marks.filter(m => m.peek !== 'none').length}</span> peeked
              </div>

              <div className="flex items-center gap-3">
                {marks.length === 0 ? (
                  <button
                    onClick={() => {
                      db.passages.update(passage.id, { phase: 'completed', status: 'completed' });
                      setPassage({ ...passage, phase: 'completed', status: 'completed' });
                      router.push('/');
                    }}
                    className="text-xs text-[var(--ink-muted)] hover:underline"
                  >
                    Nothing to mark → Finish
                  </button>
                ) : null}

                <button
                  onClick={handleTransitionToReveal}
                  disabled={marks.length === 0}
                  className="px-5 py-2 rounded-xl text-xs sm:text-sm font-semibold bg-[var(--primary)] text-white hover:bg-[var(--primary-hover)] transition disabled:opacity-40 disabled:cursor-not-allowed shadow-sm flex items-center gap-1.5"
                >
                  <span>Reveal ({marks.length})</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </>
          ) : passage.phase === 'revealed' ? (
            <>
              <div className="text-xs text-[var(--ink-muted)]">
                Reviewing definitions and verifying guesses.
              </div>
              <button
                onClick={handleTransitionToReRead}
                className="px-5 py-2 rounded-xl text-xs sm:text-sm font-semibold bg-[var(--primary)] text-white hover:bg-[var(--primary-hover)] transition shadow-sm flex items-center gap-1.5"
              >
                <span>Start re-reading →</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </>
          ) : (
            /* Pass 2 / Completed */
            <>
              <div className="flex items-center gap-3">
                <button
                  onClick={handleToggleReadAloud}
                  className={cn(
                    'px-3.5 py-1.5 rounded-lg text-xs font-semibold border transition flex items-center gap-1.5',
                    isPlayingAudio
                      ? 'border-[var(--primary)] bg-[var(--primary-tint)] text-[var(--primary)]'
                      : 'border-[var(--border)] bg-[var(--bg)] text-[var(--ink)] hover:bg-[var(--surface-hover)]'
                  )}
                >
                  {isPlayingAudio ? <Square className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                  <span>{isPlayingAudio ? 'Stop audio' : 'Read aloud'}</span>
                </button>

                <button
                  onClick={() => setIsRevealOpen(!isRevealOpen)}
                  className="text-xs text-[var(--ink-muted)] hover:text-[var(--ink)] hidden sm:inline"
                >
                  {isRevealOpen ? 'Hide side panel' : 'Show side panel'}
                </button>
              </div>

              <div className="flex items-center gap-3">
                <span className="text-xs text-[var(--ink-muted)] hidden sm:inline">
                  {marks.filter(m => m.addToBank).length} words to add
                </span>

                <button
                  onClick={() => setShowFinishModal(true)}
                  className="px-5 py-2 rounded-xl text-xs sm:text-sm font-semibold bg-[var(--primary)] text-white hover:bg-[var(--primary-hover)] transition shadow-sm flex items-center gap-1.5"
                >
                  <Check className="w-4 h-4" />
                  <span>Finish &amp; add to Word Bank</span>
                </button>
              </div>
            </>
          )}
        </div>
      </footer>

      {/* Reveal Panel */}
      <RevealPanel
        marks={marks}
        passageText={passage.text}
        glosses={glosses}
        wordsMap={wordsMap}
        isOpen={isRevealOpen}
        hasApiKey={Boolean(settings.apiKey)}
        onClose={() => setIsRevealOpen(false)}
        onStartReReading={handleTransitionToReRead}
        onUpdateMark={async (markId, updates) => {
          await db.marks.update(markId, updates);
          setMarks(prev => prev.map(m => (m.id === markId ? { ...m, ...updates } : m)));
        }}
        onApplySegmentation={async (markId, suggested) => {
          const mark = marks.find(m => m.id === markId);
          if (!mark) return;
          const sOffset = passage.text.indexOf(suggested, Math.max(0, mark.start - 10));
          if (sOffset !== -1) {
            const eOffset = sOffset + suggested.length;
            const newMerges = [...passage.merges, { start: sOffset, end: eOffset }];
            const resegmented = await segmentTextWithDictionary(passage.text, newMerges);
            await db.passages.update(passage.id, { tokens: resegmented, merges: newMerges });
            await db.marks.update(markId, { start: sOffset, end: eOffset, surface: suggested });
            setPassage({ ...passage, tokens: resegmented, merges: newMerges });
            setMarks(prev =>
              prev.map(m => (m.id === markId ? { ...m, start: sOffset, end: eOffset, surface: suggested } : m))
            );
          }
        }}
        onHoverMark={id => setHoveredMarkId(id)}
        selectedMarkId={selectedPanelMarkId}
        onSelectMark={id => setSelectedPanelMarkId(id)}
        toneColorsEnabled={settings.toneColors}
        ttsVoice={settings.ttsVoice}
        ttsSpeed={settings.ttsSpeed}
      />

      {/* Finish Modal */}
      {showFinishModal && (
        <FinishModal
          charCount={passage.text.length}
          newWordsCount={newWordsCount}
          reviewSoonerCount={reviewSoonerCount}
          onClose={() => setShowFinishModal(false)}
          onConfirmFinish={handleConfirmFinish}
        />
      )}
    </div>
  );
}
