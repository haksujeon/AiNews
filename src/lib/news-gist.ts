import type { NewsItem } from "./news-types";
import { getContent } from "./news-utils";

/*
 * 본문 번역 요지(P0-7, 2026-11).
 * 번역 전문(content_kr/content_en)은 공개 화면·RSC 페이로드·공개 API 로 내보내지 않는다(저작권: 요약 + 원문 링크).
 * 대신 번역문 앞부분 3~5문장만 서버에서 잘라 `gist` 로 넘긴다.
 *
 * 상세 페이지·모달(가로채기 라우트)·/api/news/[id] — 그리고 이후 RSS·이메일 — 모두 이 파일의
 * toGist / toPublicNewsItem 만 쓴다 (Gate 2: 같은 결과 = 같은 함수).
 * 이 파일은 DB 를 부르지 않는다(단위 테스트·스크립트에서 그대로 가져다 쓸 수 있게).
 */

export interface GistOptions {
  /** 이보다 문장이 적으면 자르지 않고 전부 쓴다(글자 상한은 그대로 적용). 기본 3 */
  min?: number;
  /** 최대 문장 수. 기본 5 */
  max?: number;
  /** 최대 글자 수. 기본은 언어별(GIST_MAX_CHARS). 문장 수보다 우선한다 */
  maxChars?: number;
}

/** 언어별 요지 글자 상한. ko 600 은 수용 기준. */
export const GIST_MAX_CHARS: Record<string, number> = { ko: 600, en: 900, zh: 300 };

const CJK_TERMINATORS = "。！？";
const LATIN_TERMINATORS = ".!?";
// 문장부호 바로 뒤에 붙는 닫는 따옴표·괄호는 앞 문장에 붙인다.
const CLOSERS = "\"'”’」』）)]〕》";

function isTerminator(ch: string): boolean {
  return CJK_TERMINATORS.includes(ch) || LATIN_TERMINATORS.includes(ch) || ch === "…";
}

/**
 * 문장 나누기. 줄바꿈은 항상 경계다(stripHtml 이 문단·<br> 을 줄바꿈으로 바꾼다).
 * - 。！？ 뒤는 바로 경계
 * - . ! ? … 뒤는 공백·끝이 올 때만 경계 → 12.1%, 2,019억, 286.68만, v1.5 같은 숫자는 나누지 않는다
 * - "U.S. " 처럼 대문자 한 글자 약어 뒤의 점은 경계로 보지 않는다
 */
export function splitSentences(text: string | null | undefined): string[] {
  if (!text) return [];
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const s = line.replace(/\s+/g, " ").trim();
    if (!s) continue;
    let start = 0;
    let i = 0;
    while (i < s.length) {
      const ch = s[i];
      if (!isTerminator(ch)) {
        i++;
        continue;
      }
      let j = i;
      while (j + 1 < s.length && isTerminator(s[j + 1])) j++; // ?! ... 。。 묶음
      while (j + 1 < s.length && CLOSERS.includes(s[j + 1])) j++;
      const next = s[j + 1];
      const cjk = [...s.slice(i, j + 1)].some((c) => CJK_TERMINATORS.includes(c));
      const atBoundary = next === undefined || next === " " || cjk;
      const abbreviation =
        ch === "." && i === j && i >= 1 && /[A-Z]/.test(s[i - 1]) && (i === 1 || /[\s.]/.test(s[i - 2]));
      if (atBoundary && !abbreviation) {
        const sentence = s.slice(start, j + 1).trim();
        if (sentence) out.push(sentence);
        start = j + 1;
      }
      i = j + 1;
    }
    const rest = s.slice(start).trim();
    if (rest) out.push(rest);
  }
  return out;
}

/**
 * 번역문 → 3~5문장 요지. 글자 상한(ko 600)을 넘기는 문장은 넣지 않는다.
 * 첫 문장만으로 상한을 넘으면 상한에서 자르고 "…" 를 붙인다.
 * 문장이 min 보다 적으면 자르지 않고 그대로(공백만 정리) 돌려준다.
 */
export function toGist(text: string | null | undefined, locale: string, opts: GistOptions = {}): string {
  const min = opts.min ?? 3;
  const max = opts.max ?? 5;
  const maxChars = opts.maxChars ?? GIST_MAX_CHARS[locale] ?? GIST_MAX_CHARS.ko;
  const sentences = splitSentences(text);
  if (sentences.length === 0) return "";

  const sep = locale === "zh" ? "" : " ";
  const picked = sentences.length < min ? sentences : sentences.slice(0, max);
  let out = "";
  for (const s of picked) {
    const next = out ? out + sep + s : s;
    if (next.length > maxChars) break;
    out = next;
  }
  if (!out) out = `${sentences[0].slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`;
  return out;
}

/** 공개 화면·API 로 내보내는 기사. 번역 전문 필드가 없고 요지(gist)가 있다. */
export type PublicNewsItem = Omit<NewsItem, "content_kr" | "content_en"> & {
  /** 번역 요지(3~5문장). 번역문이 없거나 zh 화면이면 "" */
  gist: string;
};

/**
 * 서버에서만 부른다: DB 행 → 공개용 기사. content_kr/content_en 을 지우고(키 자체를 뺀다) gist 를 넣는다.
 * zh 는 getContent 가 "" 라 gist 도 "" — 화면은 원문 매체 안내만 보인다.
 */
export function toPublicNewsItem(news: NewsItem, locale: string): PublicNewsItem {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { content_kr, content_en, ...rest } = news;
  return { ...rest, gist: toGist(getContent(news, locale), locale) };
}
