// Reparte los selectores cosméticos específicos en grupos ("buckets") que se registran
// como content scripts con `matches` limitados a los sitios que tienen selectores.
// Así una página sin selectores propios no carga ni analiza nada de esto.

import type { SpecificData } from './index.ts';
import type { CosmeticPayload } from '../content/cosmetic.ts';

export const BUCKET_COUNT = 32;

/** Host válido para un patrón `*://*.host/*`. */
const MATCHABLE_HOST = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;

export function isMatchableHost(host: string): boolean {
  return MATCHABLE_HOST.test(host) && !/^\d+\.\d+\.\d+\.\d+$/.test(host);
}

export function hostPattern(host: string): string {
  return `*://*.${host}/*`;
}

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export interface BucketPlan {
  /** Siempre activo: genéricos con excepciones, entidades (example.*) y hosts no expresables. */
  always: CosmeticPayload;
  buckets: { id: string; matches: string[]; payload: CosmeticPayload }[];
}

class PayloadBuilder {
  s: string[] = [];
  h: Record<string, number[]> = {};
  x: Record<string, number[]> = {};
  g: [number, string[]][] = [];
  private index = new Map<string, number>();

  idx(sel: string): number {
    let i = this.index.get(sel);
    if (i === undefined) {
      i = this.s.push(sel) - 1;
      this.index.set(sel, i);
    }
    return i;
  }

  has(sel: string): boolean {
    return this.index.has(sel);
  }

  /** Añade las excepciones #@# que afectan a selectores de este payload. */
  addExceptions(exceptions: Record<string, string[]>) {
    for (const [domain, sels] of Object.entries(exceptions)) {
      const relevant = sels.filter((s) => this.has(s)).map((s) => this.idx(s));
      if (relevant.length) this.x[domain] = relevant;
    }
  }

  build(extra: Partial<CosmeticPayload> = {}): CosmeticPayload {
    const p: CosmeticPayload = { s: this.s, h: this.h, x: this.x, ...extra };
    if (this.g.length) p.g = this.g;
    return p;
  }
}

export function planBuckets(data: SpecificData, generichideDomains: string[], count = BUCKET_COUNT): BucketPlan {
  const resolve = (ids: number[]) => ids.map((i) => data.s[i]!);
  const exceptions: Record<string, string[]> = {};
  for (const [d, ids] of Object.entries(data.x)) exceptions[d] = resolve(ids);

  const always = new PayloadBuilder();
  const builders = Array.from({ length: count }, () => new PayloadBuilder());
  const hosts: string[][] = Array.from({ length: count }, () => []);

  for (const [host, ids] of Object.entries(data.h)) {
    const sels = resolve(ids);
    if (isMatchableHost(host)) {
      const b = fnv1a(host) % count;
      builders[b]!.h[host] = sels.map((s) => builders[b]!.idx(s));
      hosts[b]!.push(host);
    } else {
      always.h[host] = sels.map((s) => always.idx(s));
    }
  }
  for (const [i, domains] of data.g) always.g.push([always.idx(data.s[i]!), domains]);

  always.addExceptions(exceptions);
  for (const b of builders) b.addExceptions(exceptions);

  return {
    always: always.build({ gh: generichideDomains }),
    buckets: builders
      .map((b, i) => ({
        id: `b${String(i).padStart(2, '0')}`,
        matches: hosts[i]!.sort().map(hostPattern),
        payload: b.build(),
      }))
      .filter((b) => b.matches.length > 0),
  };
}
