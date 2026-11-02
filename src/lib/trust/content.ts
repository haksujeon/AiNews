/**
 * content/legal/{locale}/{name}.md 읽기 (서버 전용, P0-6).
 * 긴 본문(소개·방법론·처리방침)은 messages 가 아니라 이 파일들에 둔다. 빌드 산출물에 들어가도록
 * next.config.ts 의 outputFileTracingIncludes 에 content/legal 을 넣었다.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { routing } from "@/i18n/routing";

export type LegalDoc = "about" | "methodology" | "privacy" | "corrections";

const cache = new Map<string, string>();

export async function loadLegal(locale: string, name: LegalDoc): Promise<string> {
  const loc = (routing.locales as readonly string[]).includes(locale) ? locale : routing.defaultLocale;
  const key = `${loc}/${name}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const src = await readFile(path.join(process.cwd(), "content", "legal", loc, `${name}.md`), "utf8");
  cache.set(key, src);
  return src;
}
