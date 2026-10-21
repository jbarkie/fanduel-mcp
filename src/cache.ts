import type { Cached, Slate } from "./types";

export const KEYS = { slate: "slate" };

export interface KVLike {
  get(key: string, type: "text"): Promise<string | null>;
}

// Parsed values are kept in isolate memory so warm requests skip JSON parsing. The
// promise is stored, so concurrent reads of the same key share one parse. The cache job
// refreshes hourly, so a few minutes of isolate staleness is harmless.
const memo = new Map<string, { at: number; value: Promise<unknown> }>();
const MEMO_MS = 5 * 60 * 1000;

function read<T>(kv: KVLike, key: string): Promise<T | null> {
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < MEMO_MS) return hit.value as Promise<T | null>;
  const value = kv.get(key, "text").then((text) => (text === null ? null : (JSON.parse(text) as T)));
  memo.set(key, { at: Date.now(), value });
  value.catch(() => memo.delete(key)); // don't cache failures
  return value;
}

export const clearMemo = () => memo.clear();

export class DataCache {
  constructor(readonly kv: KVLike) {}
  slate = () => read<Cached<Slate>>(this.kv, KEYS.slate);
}
