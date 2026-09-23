/** Coalesce keystrokes, serialize writes, and retain failed drafts for retry. */
export class SaveQueue<T extends { id: string }> {
  private pending = new Map<string, T>();
  private running: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor(private write: (value: T) => Promise<void>, private changed: (busy: boolean, error?: Error) => void) {}
  schedule(value: T) {
    this.pending.set(value.id, value);
    this.changed(true);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { void this.flush().catch(() => {}); }, 300);
  }
  async flush(): Promise<void> {
    clearTimeout(this.timer);
    if (this.running) { await this.running; if (this.pending.size) await this.flush(); return; }
    this.running = this.drain();
    try { await this.running; } finally { this.running = null; }
  }
  private async drain() {
    try {
      while (this.pending.size) {
        const [id, value] = this.pending.entries().next().value!;
        this.pending.delete(id);
        try { await this.write(value); }
        catch (error) { if (!this.pending.has(id)) this.pending.set(id, value); throw error; }
      }
      this.changed(false);
    } catch (error) {
      this.changed(false, error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }
}
