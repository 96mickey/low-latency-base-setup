/**
 * O(1) LRU Map: evicts least-recently-used when at capacity.
 */

type Node<K> = { key: K; prev: Node<K> | null; next: Node<K> | null };

export class LruMap<K, V> {
  private readonly maxSize: number;

  private readonly map = new Map<K, { value: V; node: Node<K> }>();

  private readonly head: Node<K>;

  private readonly tail: Node<K>;

  constructor(maxSize: number) {
    if (maxSize < 1) {
      throw new Error('LruMap maxSize must be >= 1');
    }
    this.maxSize = maxSize;
    this.head = { key: null as unknown as K, prev: null, next: null };
    this.tail = { key: null as unknown as K, prev: null, next: null };
    this.head.next = this.tail;
    this.tail.prev = this.head;
  }

  get size(): number {
    return this.map.size;
  }

  get(key: K): V | undefined {
    const entry = this.map.get(key);
    if (entry === undefined) return undefined;
    this.detach(entry.node);
    this.attachHead(entry.node);
    return entry.value;
  }

  set(key: K, value: V): void {
    const existing = this.map.get(key);
    if (existing !== undefined) {
      existing.value = value;
      this.detach(existing.node);
      this.attachHead(existing.node);
      return;
    }

    if (this.map.size >= this.maxSize) {
      const lru = this.tail.prev;
      if (lru !== null && lru !== this.head) {
        this.map.delete(lru.key);
        this.detach(lru);
      }
    }

    const node: Node<K> = { key, prev: null, next: null };
    this.map.set(key, { value, node });
    this.attachHead(node);
  }

  has(key: K): boolean {
    return this.map.has(key);
  }

  delete(key: K): boolean {
    const entry = this.map.get(key);
    if (entry === undefined) return false;
    this.detach(entry.node);
    this.map.delete(key);
    return true;
  }

  /** Iterate all entries (order not guaranteed). */
  forEachEntry(fn: (key: K, value: V) => void): void {
    for (const [key, entry] of this.map) {
      fn(key, entry.value);
    }
  }

  private detach(node: Node<K>): void {
    const { prev, next } = node;
    if (prev !== null) prev.next = next;
    if (next !== null) next.prev = prev;
    node.prev = null;
    node.next = null;
  }

  private attachHead(node: Node<K>): void {
    const first = this.head.next;
    if (first === null) return;
    node.prev = this.head;
    node.next = first;
    this.head.next = node;
    first.prev = node;
  }
}
