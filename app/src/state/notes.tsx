import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { Note, newNote } from '../core/model';
import { SaveQueue } from '../core/save-queue';
import * as storage from '../services/platform';

type Store = { notes: Note[]; loading: boolean; saving: boolean; error: string; update(note: Note): void; create(): Promise<Note>; remove(note: Note): Promise<void>; flush(): Promise<void>; reload(): Promise<void> };
const Context = createContext<Store | null>(null);
export function NotesProvider({ children }: { children: React.ReactNode }) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const queue = useRef<SaveQueue<Note> | null>(null);
  if (queue.current === null) queue.current = new SaveQueue(storage.saveNote, (busy, error) => { setSaving(busy); setError(error?.message || ''); });
  async function reload() {
    setLoading(true);
    try { await queue.current!.flush(); setNotes(await storage.listNotes()); setError(''); }
    catch (error) { setError(error instanceof Error ? error.message : '기록을 불러오지 못했습니다.'); }
    finally { setLoading(false); }
  }
  useEffect(() => {
    void storage.listNotes().then(setNotes).catch(error => setError(String(error))).finally(() => setLoading(false));
    const sub = AppState.addEventListener('change', state => { if (state !== 'active') void queue.current!.flush().catch(() => {}); });
    const flush = () => { void queue.current!.flush().catch(() => {}); };
    if (Platform.OS === 'web') document.addEventListener('visibilitychange', flush);
    return () => { sub.remove(); if (Platform.OS === 'web') document.removeEventListener('visibilitychange', flush); flush(); };
  }, []);
  const value: Store = {
    notes, loading, saving, error, reload,
    update(note) { const next = { ...note, updatedAt: new Date().toISOString() }; setNotes(current => current.map(n => n.id === next.id ? next : n)); queue.current!.schedule(next); },
    async create() { const note = newNote(); await storage.saveNote(note); setNotes(current => [note, ...current]); return note; },
    async remove(note) { await queue.current!.flush(); await storage.deleteNote(note); setNotes(current => current.filter(n => n.id !== note.id)); },
    flush: () => queue.current!.flush(),
  };
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useNotes() { const store = useContext(Context); if (!store) throw new Error('NotesProvider missing'); return store; }
