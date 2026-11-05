/**
 * 브리핑 음성·카드 — 화면(서버·클라이언트)이 함께 쓰는 순수 부분. DB·파일은 media-store.ts.
 *
 * 브리핑 페이지(듣기 막대·목차 시각·"이 부분 듣기"·아래 재생 막대·한 장 요약), 관리자 검토 화면,
 * 날짜 팝업과 홈 카드의 듣기 버튼이 모두 이 모양 하나를 읽는다 (Gate 2).
 */
import { BASE_PATH } from "@/lib/api-path";
import type { BriefingLocale } from "./types";

export type MediaKind = "audio" | "card";
export type MediaStatus = "review" | "approved" | "rejected";

/** t 초에 주요 기사 rank 가 시작한다. rank null = 인사·정리 */
export interface MediaChapter {
  t: number;
  rank: number | null;
}

export interface BriefingAudio {
  url: string;
  duration_sec: number;
  chapters: MediaChapter[];
  /** 받아쓰기 (대본 보기). 없으면 null */
  transcript: string | null;
  source: string;
  status: MediaStatus;
}

export interface BriefingCard {
  url: string;
  width: number;
  height: number;
  /** 그림 대신 읽을 글 — 브리핑 데이터로 만든다 (그림 속 글자에 기대지 않음) */
  alt_text: string;
  source: string;
  status: MediaStatus;
}

export interface BriefingMediaSet {
  audio?: BriefingAudio;
  card?: BriefingCard;
}

/** 공개 주소. 파일 이름이 아니라 판·언어·종류로 부른다 (파일 위치는 서버만 안다) */
export function mediaUrl(date: string, locale: BriefingLocale, kind: MediaKind, version?: string): string {
  const v = version ? `?v=${encodeURIComponent(version)}` : "";
  return `${BASE_PATH}/api/briefing/media/${date}/${locale}/${kind}${v}`;
}

/** "1:25" · "01:02:03" → 초. 못 읽으면 null */
export function parseClock(s: string): number | null {
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  return (m[1] ? Number(m[1]) * 3600 : 0) + Number(m[2]) * 60 + Number(m[3]);
}

/** "1:25" 형식 (시간이 있으면 1:02:03) */
export function formatClock(sec: number): string {
  const s = Math.max(0, Math.floor(Number.isFinite(sec) ? sec : 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${r}` : `${m}:${r}`;
}

// 서수 — 언어별 음성 지시문(audio-check.ts audioInstructions)이 시키는 말. 세 언어 표현이 겹치지 않아 한 목록으로 찾는다.
// zh 는 "第一轮融资" 같은 본문을 피하려고 뒤에 쉼표·条·个 가 올 때만, en 은 문장 첫머리 대문자 + 쉼표일 때만.
const ZH_P = "(^|[\\s，。、：！？])";
const ORDINALS: [RegExp, number][] = [
  [/(^|\s)(첫째|첫 번째|첫번째)/, 1],
  [/(^|\s)(둘째|두 번째|두번째)/, 2],
  [/(^|\s)(셋째|세 번째|세번째)/, 3],
  [/(^|\s)(넷째|네 번째|네번째)/, 4],
  [/(^|\s)(다섯째|다섯 번째|다섯번째)/, 5],
  [/(^|\s)(여섯째|여섯 번째)/, 6],
  [/(^|\s)(일곱째|일곱 번째)/, 7],
  ...(["一", "二", "三", "四", "五", "六", "七"] as const).map((d, i) => [new RegExp(`${ZH_P}第${d}(条新闻|条|个)?[，,、：:]`), i + 1] as [RegExp, number]),
  ...(["First", "Second", "Third", "Fourth", "Fifth", "Sixth", "Seventh"] as const).map((w, i) => [new RegExp(`(^|[.!?]\\s+|\\s)${w}(ly)?\\s*[,:]`), i + 1] as [RegExp, number]),
];
const LAST_WORDS = /(마지막|最后|Finally|Lastly)/;
const OUTRO_WORDS = /(요약하자면|정리하면|정리하자면|오늘 브리핑은 여기까지|总结一下|总的来说|以上就是|To sum up|In summary|That wraps up|That's all for)/;

/**
 * 받아쓰기("A: 0:24 자, 첫째. …" 한 줄에 한 발화)에서 주요 기사의 시작 시각을 찾는다.
 * 서수(첫째·둘째…)가 처음 나온 줄의 시각을 그 rank 의 시작으로 본다. 같은 rank 는 처음 것만.
 * 첫 기사 앞은 인사(rank null, 0초), 마지막 기사 뒤 "요약하자면·정리하면"은 정리(rank null).
 * 찾지 못한 기사는 빠진다 — 화면은 시각이 있는 기사에만 시각을 붙이고 재생은 그대로 둔다.
 */
export function chaptersFromTranscript(transcript: string, storyCount: number): MediaChapter[] {
  const found = new Map<number, number>();
  let outro: number | null = null;
  for (const line of transcript.split(/\r?\n/)) {
    const m = /^\s*(?:[A-Z가-힣]{1,8}\s*:\s*)?(\d{1,2}:\d{2}(?::\d{2})?)\s+(.*)$/.exec(line);
    if (!m) continue;
    const t = parseClock(m[1]);
    if (t === null) continue;
    const text = m[2];
    for (const [re, rank] of ORDINALS) {
      if (rank <= storyCount && !found.has(rank) && re.test(text)) {
        found.set(rank, t);
        break;
      }
    }
    if (LAST_WORDS.test(text) && !found.has(storyCount) && found.size === storyCount - 1) found.set(storyCount, t);
    if (found.size && outro === null && OUTRO_WORDS.test(text)) outro = t;
  }
  const ranks = [...found.entries()].sort((a, b) => a[1] - b[1]);
  // 시각이 rank 순서와 어긋나면(잘못 잡힘) 그 뒤를 버린다
  const ordered: [number, number][] = [];
  for (const [rank, t] of ranks) {
    if (ordered.length && rank <= ordered[ordered.length - 1][0]) continue;
    ordered.push([rank, t]);
  }
  if (!ordered.length) return [];
  const out: MediaChapter[] = [];
  if (ordered[0][1] > 0) out.push({ t: 0, rank: null });
  for (const [rank, t] of ordered) out.push({ t, rank });
  if (outro !== null && outro > ordered[ordered.length - 1][1]) out.push({ t: outro, rank: null });
  return out;
}

/** 지금 재생 위치의 장 (없으면 null) */
export function chapterAt(chapters: MediaChapter[], t: number): MediaChapter | null {
  let cur: MediaChapter | null = null;
  for (const c of chapters) if (t >= c.t) cur = c;
  return cur;
}

/** rank 기사의 시작 시각 (없으면 null) */
export function chapterStart(chapters: MediaChapter[], rank: number): number | null {
  return chapters.find((c) => c.rank === rank)?.t ?? null;
}

/**
 * 카드 그림 대신 읽을 글 — 그림 속 글자가 아니라 브리핑 데이터로 만든다 (그림이 바뀌어도 같은 규칙).
 * heading 은 호출자가 그 언어로 넘긴다 (예: "11월 4일 판 한 장 요약"). numbersLabel 도 마찬가지 (예: "숫자")
 */
export function cardAltText(
  content: { headline: string; top_stories: { rank: number; title: string }[]; key_numbers: { value: string; label: string }[] },
  heading: string,
  numbersLabel: string
): string {
  const stories = content.top_stories.map((s) => `${s.rank}. ${s.title}`).join(" ");
  const nums = content.key_numbers.map((k) => `${k.value} ${k.label}`).join(", ");
  return [`${heading}: ${content.headline}.`, stories, nums ? `${numbersLabel}: ${nums}.` : ""].filter(Boolean).join(" ");
}
