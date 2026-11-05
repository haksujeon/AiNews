/**
 * NotebookLM 브리핑 음성 — 자료 만들기·받아쓰기 정리·숫자 대조 (사용자 결정 2026-11-05: 음성은 NotebookLM).
 *
 * NotebookLM 은 같은 자료로도 만들 때마다 숫자를 틀리는 곳이 다르다 (시험: "iOS 27.3"→"18.2", "170억"→"1,070억").
 * 그래서 음성을 받아써서 숫자를 자료와 대조하고, 틀리면 다시 만든다 (scripts/briefing-audio.ts).
 * 숫자 비교는 브리핑 번역 검사와 같은 valueSets/numericValues (Gate 2).
 * 받아쓰기는 기계라서 고유명사 오자가 있다 — 그래서 대조는 숫자만, 받아쓰기는 공개 화면에 보이지 않는다(briefing-media.tsx).
 */
import { chaptersFromTranscript, formatClock, type MediaChapter } from "./media";
import { numericValues } from "./translate";
import type { BriefingContent } from "./types";

/** NotebookLM 에 넣는 자료 — 그 판 브리핑 내용만 (히스토리·과거 기사 없음: 과거 숫자가 섞이지 않게) */
export function audioSourceMarkdown(c: Pick<BriefingContent, "headline" | "lede" | "top_stories" | "key_numbers" | "sections" | "companies_to_watch">, dateLabel: string): string {
  const o = [`# ${dateLabel} 판 중국 AI 데일리 브리핑 (이 판의 기사만)`, "", `헤드라인: ${c.headline}`, "", c.lede, "", "## 주요 기사"];
  for (const s of c.top_stories) o.push(`### ${s.rank}. ${s.title}`, `무슨 일: ${s.what}`, `왜 중요한가: ${s.why ?? ""}`, "");
  if (c.key_numbers.length) o.push("## 숫자로 보는 하루", ...c.key_numbers.map((k) => `- ${k.value}: ${k.label}`), "");
  if (c.sections.length) o.push("## 그 밖의 소식", ...c.sections.flatMap((sec) => sec.items.map((it) => `- ${it.text}`)), "");
  if (c.companies_to_watch.length) o.push("## 주목할 기업", ...c.companies_to_watch.map((x) => `- ${x.name}: ${x.why}`));
  return o.join("\n");
}

/** NotebookLM 음성 지시문 (brief 형식). 시험에서 틀린 곳(버전 번호·해석 문장·발음)을 직접 짚는다 */
export const AUDIO_INSTRUCTIONS =
  '한국어 1인 진행자의 짧은 아침 뉴스 브리핑. 자료의 주요 기사를 1번부터 순서대로 "첫째, 둘째, 셋째, 넷째, 다섯째"로 시작해 소개할 것. ' +
  "숫자·날짜·버전 번호(예: iOS 27.3)·금액은 자료에 적힌 표기를 한 글자도 바꾸지 말고 그대로 읽을 것. " +
  '자료에 없는 숫자·배경지식·전망·평가·의견 문장을 절대 덧붙이지 말 것 (예: "구조적 한계", "모든 영역으로 진입" 같은 해석 금지). ' +
  '각 기사의 "왜 중요한가"는 자료 문장 그대로의 뜻만 전할 것. 과장 금지. "자료", "이 자료가" 같은 말 금지. ' +
  "고유명사 발음: 千问=치엔원(치에논 아님), Kimi=키미, fal=팔, MiniMax=미니맥스, Pika=피카, UniPat=유니팻, Anthropic=앤트로픽, CyberOne=사이버원, 레이쥔, 리자치, 닝더스다이, 딥시크. " +
  '마지막 문장은 "자세한 내용과 근거 기사는 브리핑 페이지에서 확인하세요."';

export interface TranscriptLine {
  t: number;
  text: string;
}

/** 받아쓰기 모델의 JSON([{t:초, text}] 또는 {lines:[…]}) → 시각 순 줄. 시각이 거꾸로 가면 앞 줄 시각으로 맞춘다 */
export function linesFromJson(raw: unknown): TranscriptLine[] {
  const arr = Array.isArray(raw) ? raw : Array.isArray((raw as { lines?: unknown })?.lines) ? (raw as { lines: unknown[] }).lines : [];
  const out: TranscriptLine[] = [];
  for (const x of arr) {
    const t = Number((x as { t?: unknown }).t);
    const text = String((x as { text?: unknown }).text ?? "").trim();
    if (!text || !Number.isFinite(t) || t < 0) continue;
    out.push({ t: Math.max(t, out.length ? out[out.length - 1].t : 0), text });
  }
  return out;
}

/**
 * 줄 시각을 글자 수 비율로 다시 매긴다 (한 사람이 고른 속도로 읽는 brief 음성).
 * 받아쓰기 모델의 시각은 1분 넘어가면 뭉개지는 일이 있다(2026-11-05: 1분 이후 전부 0:59). 비율 추정은 실측과 1초 안팎.
 */
export function retimeByLength(lines: TranscriptLine[], durationSec: number): TranscriptLine[] {
  const total = lines.reduce((n, l) => n + l.text.length, 0);
  if (!total || !(durationSec > 0)) return lines;
  let acc = 0;
  return lines.map((l) => {
    const t = Math.floor((durationSec * acc) / total);
    acc += l.text.length;
    return { t, text: l.text };
  });
}

/** "A: 0:24 문장" 글 → 줄 (저장된 받아쓰기를 다시 매길 때) */
export function linesFromTranscript(transcript: string): TranscriptLine[] {
  const out: TranscriptLine[] = [];
  for (const line of transcript.split(/\r?\n/)) {
    const m = /^\s*[A-Z]\s*:\s*(\d+):(\d{2})\s+(.*)$/.exec(line);
    if (m && m[3].trim()) out.push({ t: Number(m[1]) * 60 + Number(m[2]), text: m[3].trim() });
  }
  return out;
}

/** 저장·장 찾기용 글 ("A: 0:24 문장" 한 줄씩 — chaptersFromTranscript 가 읽는 꼴) */
export function transcriptText(lines: TranscriptLine[]): string {
  return lines.map((l) => `A: ${formatClock(l.t)} ${l.text}`).join("\n");
}

export interface AudioCheck {
  ok: boolean;
  /** 자료에 없는 숫자 (받아쓰기 기준) */
  unknownNumbers: string[];
  chapters: MediaChapter[];
  /** 장(서수)을 찾은 주요 기사 수 / 전체 */
  chaptersFound: number;
  storyCount: number;
}

/**
 * 받아쓰기의 숫자가 모두 자료에 있는지 + 주요 기사마다 장(서수)이 있는지.
 * 받아쓰기 오자로 생긴 가짜 숫자도 걸릴 수 있다 — 그때는 다시 만든다(더 엄격한 쪽으로 틀린다).
 */
export function checkTranscript(transcript: string, source: string, storyCount: number): AudioCheck {
  const src = numericValues(source);
  // 시각 표기("A: 1:25")는 숫자 비교에서 뺀다
  const body = transcript.replace(/^\s*[A-Z]\s*:\s*\d+:\d{2}(?::\d{2})?\s*/gm, "");
  const unknownNumbers = [...numericValues(body)].filter((v) => !src.has(v));
  const chapters = chaptersFromTranscript(transcript, storyCount);
  const chaptersFound = chapters.filter((c) => c.rank !== null).length;
  return { ok: unknownNumbers.length === 0 && chaptersFound === storyCount, unknownNumbers, chapters, chaptersFound, storyCount };
}

export const TRANSCRIBE_PROMPT =
  "이 한국어 뉴스 음성을 빠짐없이 받아써라. 들리는 그대로 적고 고치지 말 것(숫자도 들리는 그대로 아라비아 숫자로). " +
  'JSON 하나만 출력: {"lines":[{"t":문장이 시작하는 초(정수),"text":"문장"}]}. 한 문장이 한 항목.';

/**
 * 두 번 받아쓴 결과에서 "양쪽 모두에 나온" 모르는 숫자만 진짜 오류로 본다.
 * 큰 복합 숫자("8954억")는 받아쓰기 모델이 흔들려 한 번은 틀리게 적는다(2026-11-05 실측). 음성이 정말 틀린 경우
 * ("iOS 18.2", "1,070억")는 두 번 받아써도 같은 숫자로 나왔다.
 */
export function confirmedUnknown(first: string[], second: string[]): string[] {
  const b = new Set(second);
  return first.filter((v) => b.has(v));
}
