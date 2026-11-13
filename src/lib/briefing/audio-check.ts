/**
 * NotebookLM 브리핑 음성 — 자료 만들기·받아쓰기 정리·숫자 대조 (사용자 결정 2026-11-05: 음성은 NotebookLM).
 *
 * NotebookLM 은 같은 자료로도 만들 때마다 숫자를 틀리는 곳이 다르다 (시험: "iOS 27.3"→"18.2", "170억"→"1,070억").
 * 그래서 음성을 받아써서 숫자를 자료와 대조하고, 틀리면 다시 만든다 (scripts/briefing-audio.ts).
 * 숫자 비교는 브리핑 번역 검사와 같은 valueSets/numericValues (Gate 2).
 * 받아쓰기는 기계라서 고유명사 오자가 있다 — 그래서 대조는 숫자만, 받아쓰기는 공개 화면에 보이지 않는다(briefing-media.tsx).
 */
import { chaptersFromTranscript, formatClock, MAX_ORDINAL, ORDINAL_WORDS, type MediaChapter } from "./media";
import { numericValues } from "./translate";
import type { BriefingContent } from "./types";

export type AudioLocale = "ko" | "zh" | "en";

/** 자료 머리말 — 그 판의 언어로 (NotebookLM 이 자료 언어에 끌려가지 않게) */
const SRC_LABELS: Record<AudioLocale, { title: (d: string) => string; headline: string; top: string; what: string; why: string; nums: string; other: string; cos: string }> = {
  ko: { title: (d) => `${d} 판 중국 AI 데일리 브리핑 (이 판의 기사만)`, headline: "헤드라인", top: "주요 기사", what: "무슨 일", why: "왜 중요한가", nums: "숫자로 보는 하루", other: "그 밖의 소식", cos: "주목할 기업" },
  zh: { title: (d) => `${d} 中国AI每日简报（仅本期新闻）`, headline: "头条", top: "主要新闻", what: "发生了什么", why: "为什么重要", nums: "数字看今天", other: "其他消息", cos: "值得关注的公司" },
  en: { title: (d) => `China AI Daily briefing, ${d} edition (this edition only)`, headline: "Headline", top: "Top stories", what: "What happened", why: "Why it matters", nums: "The day in numbers", other: "Other news", cos: "Companies to watch" },
};

/** NotebookLM 에 넣는 자료 — 그 판 브리핑 내용만 (히스토리·과거 기사 없음: 과거 숫자가 섞이지 않게) */
export function audioSourceMarkdown(
  c: Pick<BriefingContent, "headline" | "lede" | "top_stories" | "key_numbers" | "sections" | "companies_to_watch">,
  dateLabel: string,
  locale: AudioLocale = "ko"
): string {
  const L = SRC_LABELS[locale];
  const o = [`# ${L.title(dateLabel)}`, "", `${L.headline}: ${c.headline}`, "", c.lede, "", `## ${L.top}`];
  for (const s of c.top_stories) o.push(`### ${s.rank}. ${s.title}`, `${L.what}: ${s.what}`, `${L.why}: ${s.why ?? ""}`, "");
  if (c.key_numbers.length) o.push(`## ${L.nums}`, ...c.key_numbers.map((k) => `- ${k.value}: ${k.label}`), "");
  if (c.sections.length) o.push(`## ${L.other}`, ...c.sections.flatMap((sec) => sec.items.map((it) => `- ${it.text}`)), "");
  if (c.companies_to_watch.length) o.push(`## ${L.cos}`, ...c.companies_to_watch.map((x) => `- ${x.name}: ${x.why}`));
  return o.join("\n");
}

/**
 * 자료 머리말의 날짜 — 연도까지 (2026-11-13: 음성이 "2026년 11월 12일"이라 읽었는데 자료에 연도가 없어 숫자 대조에서 떨어졌다)
 */
export function audioDateLabel(date: string, locale: AudioLocale): string {
  const [y, m, d] = date.split("-").map(Number);
  if (locale === "ko") return `${y}년 ${m}월 ${d}일`;
  if (locale === "zh") return `${y}年${m}月${d}日`;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[m - 1]} ${d}, ${y}`;
}

/**
 * 대조용 자료 — 한글 수 단어를 숫자로도 적어 둔다 (자료 "백만 입력 토큰당" ↔ 받아쓰기 "100만", 2026-11-13).
 * 자료 쪽 숫자 모음만 넓힌다: 음성이 다른 숫자를 읽으면 여전히 걸린다.
 */
function sourceForCompare(source: string): string {
  const extra: string[] = [];
  for (const m of source.matchAll(/(?<![가-힣])(십|백|천)(만|억|조)/g)) extra.push(`${{ 십: 10, 백: 100, 천: 1000 }[m[1] as "십" | "백" | "천"]}${m[2]}`);
  return extra.length ? `${source}\n${extra.join(" ")}` : source;
}

/** NotebookLM 언어 코드 (notebooklm language list) */
export const NOTEBOOKLM_LANG: Record<AudioLocale, string> = { ko: "ko", zh: "zh_Hans", en: "en" };

/**
 * NotebookLM 음성 지시문 (brief 형식). 시험에서 틀린 곳(버전 번호·해석 문장·발음)을 직접 짚는다.
 * 서수("첫째"·"第一，"·"First,")는 장 찾기(media.ts chaptersFromTranscript)가 읽는 말 — 같은 목록(ORDINAL_WORDS)에서
 * 그 판의 주요 기사 수만큼 만든다 (2026-11-13: "다섯째"까지만 시켜 7~8개 판의 6번 이후가 장 없이 읽혔다).
 */
function ordinalList(locale: AudioLocale, storyCount: number): string {
  const n = Math.max(1, Math.min(MAX_ORDINAL, Math.floor(storyCount) || 5));
  const words = ORDINAL_WORDS[locale].slice(0, n);
  if (locale === "ko") return `주요 기사 ${n}개를 하나도 빼지 말고 1번부터 순서대로 "${words.join(", ")}"로 시작해 소개할 것.`;
  if (locale === "zh") return `按资料中主要新闻的顺序逐条介绍全部 ${n} 条，一条也不要漏，每条分别以${words.map((w) => `“${w}，”`).join("")}开头。`;
  return `Introduce all ${n} top stories in order without skipping any, starting each one with ${words.map((w) => `"${w},"`).join(" ")}.`;
}

const AUDIO_INSTRUCTIONS_BY: Record<AudioLocale, string> = {
  ko:
    '한국어 1인 진행자의 짧은 아침 뉴스 브리핑. {ORDINALS} ' +
    "숫자·날짜·버전 번호(예: iOS 27.3)·금액은 자료에 적힌 표기를 한 글자도 바꾸지 말고 그대로 읽을 것. " +
    '자료에 없는 숫자·배경지식·전망·평가·의견 문장을 절대 덧붙이지 말 것 (예: "구조적 한계", "모든 영역으로 진입" 같은 해석 금지). ' +
    '각 기사의 "왜 중요한가"는 자료 문장 그대로의 뜻만 전할 것. 과장 금지. "자료", "이 자료가" 같은 말 금지. ' +
    "고유명사 발음: 千问=치엔원(치에논 아님), Kimi=키미, fal=팔, MiniMax=미니맥스, Pika=피카, UniPat=유니팻, Anthropic=앤트로픽, CyberOne=사이버원, 레이쥔, 리자치, 닝더스다이, 딥시크. " +
    '마지막 문장은 "자세한 내용과 근거 기사는 브리핑 페이지에서 확인하세요."',
  zh:
    "用普通话、由一位主播播报的简短晨间新闻简报。{ORDINALS}" +
    "数字、日期、版本号（例如 iOS 27.3）和金额必须完全按照资料中的写法读出，一个字也不要改。" +
    "绝对不要添加资料中没有的数字、背景知识、展望、评价或观点。每条新闻的“为什么重要”只传达资料原句的意思，不要夸张。不要说“资料”“这份资料”之类的话。" +
    "最后一句说：“详细内容和来源报道，请查看简报页面。”",
  en:
    'A short morning news briefing read by a single host in English. {ORDINALS} ' +
    "Read every number, date, version number (e.g. iOS 27.3) and amount exactly as written in the source; do not round, convert or change a single digit. " +
    "Never add numbers, background, outlook, evaluation or opinion that are not in the source. For each story, convey only what its \"Why it matters\" line says, without exaggeration. Do not say \"the source\" or \"this document\". " +
    "Pronunciation: Qwen = chwen, Kimi = KEE-mee, fal = fal, MiniMax = mini-max, DeepSeek = deep-seek, Anthropic = an-THROP-ik. " +
    'End with: "Full details and source articles are on the briefing page."',
};
/** 음성 지시문 — storyCount 는 그 판의 주요 기사 수 (서수를 그만큼) */
export const audioInstructions = (locale: AudioLocale, storyCount = 5) => AUDIO_INSTRUCTIONS_BY[locale].replace("{ORDINALS}", ordinalList(locale, storyCount));
/** 한국어 (이전 이름 — 호환) */
export const AUDIO_INSTRUCTIONS = audioInstructions("ko");

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
  const src = numericValues(sourceForCompare(source));
  // 시각 표기("A: 1:25")는 숫자 비교에서 뺀다
  const body = transcript.replace(/^\s*[A-Z]\s*:\s*\d+:\d{2}(?::\d{2})?\s*/gm, "");
  const unknownNumbers = [...numericValues(body)].filter((v) => !src.has(v));
  const chapters = chaptersFromTranscript(transcript, storyCount);
  const chaptersFound = chapters.filter((c) => c.rank !== null).length;
  return { ok: unknownNumbers.length === 0 && chaptersFound === storyCount, unknownNumbers, chapters, chaptersFound, storyCount };
}

const TRANSCRIBE_BY: Record<AudioLocale, string> = {
  ko: "이 한국어 뉴스 음성을 빠짐없이 받아써라. 들리는 그대로 적고 고치지 말 것(숫자도 들리는 그대로 아라비아 숫자로). ",
  zh: "把这段中文新闻音频完整地逐字转写成简体中文。听到什么写什么，不要修改（数字也按听到的写成阿拉伯数字，如 1055亿元、30分钟）。",
  en: "Transcribe this English news audio completely, word for word, without correcting anything. Write numbers as digits exactly as heard (e.g. 105.5 billion yuan, 30 minutes). ",
};
/** 받아쓰기 지시 — 음성 언어로 */
export const transcribePrompt = (locale: AudioLocale) =>
  TRANSCRIBE_BY[locale] +
  (locale === "ko"
    ? 'JSON 하나만 출력: {"lines":[{"t":문장이 시작하는 초(정수),"text":"문장"}]}. 한 문장이 한 항목.' // 기존 한국어 지시 그대로
    : 'Output a single JSON only: {"lines":[{"t":start second of the sentence (integer),"text":"sentence"}]}. One sentence per item.');
/** 한국어 (이전 이름 — 호환) */
export const TRANSCRIBE_PROMPT = transcribePrompt("ko");

/**
 * 두 번 받아쓴 결과에서 "양쪽 모두에 나온" 모르는 숫자만 진짜 오류로 본다.
 * 큰 복합 숫자("8954억")는 받아쓰기 모델이 흔들려 한 번은 틀리게 적는다(2026-11-05 실측). 음성이 정말 틀린 경우
 * ("iOS 18.2", "1,070억")는 두 번 받아써도 같은 숫자로 나왔다.
 */
export function confirmedUnknown(first: string[], second: string[]): string[] {
  const b = new Set(second);
  return first.filter((v) => b.has(v));
}
