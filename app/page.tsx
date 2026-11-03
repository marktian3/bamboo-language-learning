'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Passage } from '@/lib/db';
import { normalizeChineseText, validateChineseText, generateDefaultTitle } from '@/lib/segment/normalize';
import { segmentTextWithDictionary } from '@/lib/segment/segmenter';
import { SAMPLE_PASSAGE } from '@/lib/sample';
import { nanoid } from 'nanoid';
import {
  BookOpen,
  Sparkles,
  Flame,
  Clock,
  MoreVertical,
  Trash2,
  Copy,
  Edit2,
  AlertTriangle,
  ArrowRight,
} from 'lucide-react';

export default function LibraryPage() {
  const router = useRouter();
  const [text, setText] = useState('');
  const [title, setTitle] = useState('');
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState('');

  // Live queries from Dexie
  const passages = useLiveQuery(
    () => db.passages.orderBy('lastOpenedAt').reverse().toArray(),
    [],
    []
  );

  const dueCount = useLiveQuery(async () => {
    try {
      const now = Date.now();
      const suspendedOrKnown = await db.words
        .where('status')
        .anyOf(['suspended', 'known'])
        .primaryKeys();
      const excluded = new Set(suspendedOrKnown);
      const cards = await db.cards.where('due').belowOrEqual(now).toArray();
      return cards.filter(c => !excluded.has(c.wordId)).length;
    } catch {
      return 0;
    }
  }, [], 0);

  const stats = useLiveQuery(async () => {
    try {
      const reviews = await db.reviewLogs.toArray();
      const reviewDates = new Set(
        reviews.map(r => new Date(r.reviewedAt).toDateString())
      );
      return {
        streakDays: reviewDates.size,
      };
    } catch {
      return { streakDays: 0 };
    }
  }, [], { streakDays: 0 });

  // Marks count map for each passage
  const marksCountMap = useLiveQuery(async () => {
    const marks = await db.marks.toArray();
    const map = new Map<string, number>();
    for (const m of marks) {
      map.set(m.passageId, (map.get(m.passageId) || 0) + 1);
    }
    return map;
  }, [], new Map<string, number>());

  // Validation
  const validation = text.trim() ? validateChineseText(text) : null;
  const isTooLong = text.length > 10000;
  const canSubmit = validation?.valid && !isTooLong;

  const handleStartReading = async () => {
    if (!canSubmit) return;

    const normalized = normalizeChineseText(text);
    const finalTitle = title.trim() || generateDefaultTitle(normalized);
    const tokens = await segmentTextWithDictionary(normalized);
    const id = nanoid(10);
    const now = Date.now();

    const passage: Passage = {
      id,
      title: finalTitle,
      text: normalized,
      tokens,
      merges: [],
      phase: 'pass1',
      status: 'pass1',
      scrollY: 0,
      createdAt: now,
      updatedAt: now,
      lastOpenedAt: now,
    };

    await db.passages.add(passage);
    router.push(`/read/${id}`);
  };

  const handleLoadSample = () => {
    setText(SAMPLE_PASSAGE.text);
    setTitle(SAMPLE_PASSAGE.title);
  };

  const handleDeletePassage = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm('Delete this passage and its marks? (Saved words in Word Bank will remain)')) {
      await db.transaction('rw', [db.passages, db.marks], async () => {
        await db.passages.delete(id);
        await db.marks.where('passageId').equals(id).delete();
      });
      setActiveMenuId(null);
    }
  };

  const handleDuplicatePassage = async (passage: Passage, e: React.MouseEvent) => {
    e.stopPropagation();
    const now = Date.now();
    const newId = nanoid(10);
    const dup: Passage = {
      ...passage,
      id: newId,
      title: `${passage.title} (Copy)`,
      phase: 'pass1',
      status: 'pass1',
      scrollY: 0,
      createdAt: now,
      updatedAt: now,
      lastOpenedAt: now,
    };
    await db.passages.add(dup);
    setActiveMenuId(null);
  };

  const handleSaveRename = async (passage: Passage, e: React.MouseEvent) => {
    e.stopPropagation();
    if (newTitle.trim()) {
      await db.passages.update(passage.id, {
        title: newTitle.trim(),
        updatedAt: Date.now(),
      });
    }
    setRenameId(null);
    setActiveMenuId(null);
  };

  const getPhaseBadge = (phase: Passage['phase']) => {
    switch (phase) {
      case 'pass1':
        return <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--surface-hover)] text-[var(--ink-muted)]">○ Pass 1</span>;
      case 'revealed':
        return <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--peek-bg)] text-[var(--peek)] font-medium">● Revealed</span>;
      case 'pass2':
        return <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--primary-tint)] text-[var(--primary)] font-medium">● Re-reading</span>;
      case 'completed':
        return <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--primary-tint)] text-[var(--primary)] font-semibold">✓ Completed</span>;
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 space-y-10">
      {/* Header with Greeting, Review Due CTA & Streak */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[var(--border)] pb-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[var(--ink)] font-serif">
            Library
          </h1>
          <p className="text-sm text-[var(--ink-muted)] mt-1">
            Paste native Chinese articles, essays, or stories to read and learn.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {dueCount > 0 ? (
            <Link
              href="/review"
              className="px-4 py-2 rounded-lg text-sm font-semibold bg-[var(--primary)] text-white hover:bg-[var(--primary-hover)] transition shadow-sm flex items-center gap-2"
            >
              <Sparkles className="w-4 h-4" />
              <span>Review {dueCount} due</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          ) : (
            <div className="text-xs text-[var(--ink-muted)] px-3 py-1.5 rounded-lg bg-[var(--surface)] border border-[var(--border)]">
              All caught up 🎋
            </div>
          )}

          {stats.streakDays > 0 && (
            <div
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--surface)] border border-[var(--border)] text-xs font-semibold text-[var(--ink)]"
              title={`${stats.streakDays} active review days`}
            >
              <Flame className="w-4 h-4 text-orange-500 fill-orange-500" />
              <span>{stats.streakDays}d</span>
            </div>
          )}
        </div>
      </div>

      {/* New Passage Paste Card */}
      <div className="bg-[var(--surface)] p-6 rounded-2xl border border-[var(--border)] shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-base font-semibold text-[var(--ink)] flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-[var(--primary)]" /> New Passage
          </span>
          <button
            type="button"
            onClick={handleLoadSample}
            className="text-xs text-[var(--primary)] hover:underline font-medium"
          >
            Load sample (朱自清《背影》)
          </button>
        </div>

        <div className="relative">
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder="Paste Chinese text here… (up to 10,000 characters)"
            rows={7}
            className="w-full p-4 rounded-xl border border-[var(--border)] bg-[var(--bg)] text-[var(--ink)] placeholder:text-[var(--ink-faint)] focus:outline-none focus:ring-2 focus:ring-[var(--focus)] font-serif text-base sm:text-lg leading-relaxed resize-y"
          />
        </div>

        {/* Live warnings & character count */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
          <div>
            {validation?.warning && (
              <span className="flex items-center gap-1 text-[var(--peek)] font-medium">
                <AlertTriangle className="w-3.5 h-3.5" />
                {validation.warning}
              </span>
            )}
            {validation?.error && (
              <span className="text-[var(--danger)] font-medium">
                {validation.error}
              </span>
            )}
          </div>
          <span className={`font-mono ${text.length > 6000 ? 'text-[var(--peek)]' : 'text-[var(--ink-muted)]'}`}>
            {text.length.toLocaleString()} / 10,000 chars
          </span>
        </div>

        {/* Title & Start Reading CTA */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-2">
          <input
            type="text"
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="Title (optional, auto-generated from first line)"
            className="flex-1 px-3.5 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-[var(--ink)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--focus)]"
          />
          <button
            onClick={handleStartReading}
            disabled={!canSubmit}
            className="px-6 py-2.5 rounded-lg text-sm font-semibold bg-[var(--primary)] text-white hover:bg-[var(--primary-hover)] transition disabled:opacity-40 disabled:cursor-not-allowed shadow-sm flex items-center justify-center gap-2"
          >
            Start reading
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Recent Passages */}
      <div className="space-y-4">
        <h2 className="text-xl font-bold tracking-tight text-[var(--ink)]">
          Recent Passages
        </h2>

        {passages.length === 0 ? (
          <div className="bg-[var(--surface)] p-12 rounded-2xl border border-[var(--border)] text-center space-y-4">
            <div className="w-14 h-14 mx-auto rounded-full bg-[var(--primary-tint)] flex items-center justify-center text-2xl font-serif text-[var(--primary)]">
              竹
            </div>
            <div className="max-w-md mx-auto">
              <h3 className="font-semibold text-base text-[var(--ink)]">No passages yet</h3>
              <p className="text-xs text-[var(--ink-muted)] mt-1">
                Paste an article or essay above, or try our sample reading to experience the 3-pass reading method.
              </p>
            </div>
            <button
              onClick={handleLoadSample}
              className="px-4 py-2 rounded-lg text-xs font-semibold bg-[var(--primary-tint)] text-[var(--primary)] hover:bg-[var(--primary)] hover:text-white transition"
            >
              Try a sample passage
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {passages.map(p => {
              const markedCount = marksCountMap.get(p.id) || 0;
              const isRenaming = renameId === p.id;
              const isMenuOpen = activeMenuId === p.id;

              return (
                <div
                  key={p.id}
                  onClick={() => router.push(`/read/${p.id}`)}
                  className="group relative bg-[var(--surface)] p-5 rounded-xl border border-[var(--border)] hover:border-[var(--primary)]/60 transition shadow-sm hover:shadow cursor-pointer flex flex-col justify-between min-h-[160px]"
                >
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      {isRenaming ? (
                        <div className="flex items-center gap-1.5 w-full" onClick={e => e.stopPropagation()}>
                          <input
                            type="text"
                            value={newTitle}
                            onChange={e => setNewTitle(e.target.value)}
                            className="px-2 py-1 text-sm border rounded bg-[var(--bg)] text-[var(--ink)] w-full"
                            autoFocus
                          />
                          <button
                            onClick={e => handleSaveRename(p, e)}
                            className="text-xs px-2 py-1 bg-[var(--primary)] text-white rounded"
                          >
                            Save
                          </button>
                        </div>
                      ) : (
                        <h3 className="font-semibold text-base text-[var(--ink)] line-clamp-2 leading-snug group-hover:text-[var(--primary)] transition">
                          {p.title}
                        </h3>
                      )}

                      {/* Overflow menu */}
                      <div className="relative" onClick={e => e.stopPropagation()}>
                        <button
                          onClick={() => setActiveMenuId(isMenuOpen ? null : p.id)}
                          className="p-1 rounded-md text-[var(--ink-muted)] hover:text-[var(--ink)] hover:bg-[var(--surface-hover)]"
                        >
                          <MoreVertical className="w-4 h-4" />
                        </button>

                        {isMenuOpen && (
                          <div className="absolute right-0 top-6 w-36 bg-[var(--surface)] border border-[var(--border)] rounded-lg shadow-lg py-1 z-20 text-xs">
                            <button
                              onClick={() => {
                                setRenameId(p.id);
                                setNewTitle(p.title);
                                setActiveMenuId(null);
                              }}
                              className="w-full text-left px-3 py-1.5 hover:bg-[var(--surface-hover)] flex items-center gap-2 text-[var(--ink)]"
                            >
                              <Edit2 className="w-3.5 h-3.5" /> Rename
                            </button>
                            <button
                              onClick={e => handleDuplicatePassage(p, e)}
                              className="w-full text-left px-3 py-1.5 hover:bg-[var(--surface-hover)] flex items-center gap-2 text-[var(--ink)]"
                            >
                              <Copy className="w-3.5 h-3.5" /> Duplicate
                            </button>
                            <button
                              onClick={e => handleDeletePassage(p.id, e)}
                              className="w-full text-left px-3 py-1.5 hover:bg-[var(--surface-hover)] flex items-center gap-2 text-[var(--danger)]"
                            >
                              <Trash2 className="w-3.5 h-3.5" /> Delete
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    <p className="text-xs text-[var(--ink-muted)] font-mono">
                      {p.text.length.toLocaleString()} chars
                    </p>
                  </div>

                  <div className="flex items-center justify-between pt-4 border-t border-[var(--border)] mt-4">
                    {getPhaseBadge(p.phase)}
                    <div className="flex items-center gap-2 text-xs text-[var(--ink-muted)]">
                      <span>{markedCount} marked</span>
                      <span>·</span>
                      <span className="flex items-center gap-0.5" title="Last opened">
                        <Clock className="w-3 h-3" />
                        {new Date(p.lastOpenedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
