// Tipos mínimos de @mozilla/readability 0.6.0 (Readability.cjs, sin modificar).
interface Article {
  title: string | null | undefined;
  content: string | null | undefined;
  textContent: string | null | undefined;
  length: number | null | undefined;
  excerpt: string | null | undefined;
  byline: string | null | undefined;
  dir: string | null | undefined;
  siteName: string | null | undefined;
  lang: string | null | undefined;
  publishedTime: string | null | undefined;
}
declare class Readability {
  constructor(doc: Document, options?: { charThreshold?: number; keepClasses?: boolean; nbTopCandidates?: number });
  parse(): Article | null;
}
export = Readability;
