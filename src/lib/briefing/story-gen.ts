/**
 * "회사·관련 주제 히스토리 분석" 자동 생성의 순수 부분 (2026-11-04 사용자 결정 "자동으로 만들어야 해").
 * 시범(~/ainews-reports/insight-easy-2026-11/story_draft.py, 11-03 판)을 옮겼다. 시범과 다른 점:
 *  - 기사마다 손으로 쓰던 검색어(회사 별칭·주제 정규식)를 PLAN 단계(LLM 1회)가 만든다. 이름표(entities.ts)에 있는 회사면 별칭을 보탠다.
 *  - 검색어는 정규식 문자를 이스케이프하고 SQL 매개변수로만 넘긴다 (story-run.ts).
 *  - ko 를 만든 뒤 zh·en 으로 옮기고, 숫자·이름·글자 검사는 데일리 번역(translate.ts)과 같은 함수를 쓴다 (Gate 2).
 * 고르기(SELECT)·엮기(SYNTH) 프롬프트와 코드 검사(checkStory)는 시범 v0.2 그대로다.
 */
import { findEntities, nameEntriesIn } from "./entities";
import { nameIssues, numericValues } from "./translate";
import { HANGUL_RE, hasHan } from "../text/han";

export type Lens = "company" | "topic";
export type StoryLocale = "ko" | "zh" | "en";

export const STORY_PROMPT_VERSION = "story-v1.1";
/** 고르기·엮기 모델 (시범과 같은 Sonnet 5.5). STORY_MODEL 로 덮어쓴다 */
export const STORY_MODEL = process.env.STORY_MODEL || "anthropic-api-sonnet-5-5";
/** 후보 기사: 오늘 판 이전 240일, 최대 150건 (시범 값) */
export const STORY_LOOKBACK_DAYS = 240;
export const STORY_MAX_CANDIDATES = 150;

// ───────────────────────── PLAN: 검색어 만들기

export const PLAN_SYSTEM = `중국 AI 뉴스 기사 하나의 "지난 흐름"을 찾기 위한 검색어를 만듭니다. 검색은 과거 기사의 한국어·중국어 제목과 요약에서 글자 그대로 찾습니다.
- company: 이 기사의 주인공 회사(또는 기관) 하나. 기사 제목과 원문에 쓰인 한국어·영문·중국어 표기를 모두(2~6개). 회사가 아닌 정부·업계 전체가 주인공이면 null.
- topic: 이 기사가 속한 주제(다른 회사들도 겪는 같은 종류의 일). name 은 독자에게 보일 주제 이름(한국어 25자 이내). terms 는 그 주제를 나타내는 핵심 낱말을 한국어와 중국어로 3~8개(예: 에이전트, 智能体, 플러그인, 插件). 너무 넓은 낱말(AI, 인공지능, 模型, 기업, 发布)은 쓰지 않습니다.
- 각 낱말은 2자 이상, 정규식 기호 없이 글자 그대로.
JSON 하나만: {"company":{"name":"","terms":[""]}|null,"topic":{"name":"","terms":[""]}}`;

export interface PlanInput {
  title: string;
  subject: string;
  what: string;
  articles: { title_kr: string; title_cn: string }[];
}

export function planUserPrompt(p: PlanInput): string {
  return `제목: ${p.title}\n주체: ${p.subject}\n무슨 일: ${p.what}\n근거 기사:\n${p.articles.map((a) => `- ${a.title_kr} / ${a.title_cn}`).join("\n")}`;
}

export interface LensPlan {
  lens: Lens;
  /** 정규식 (이스케이프된 낱말을 | 로 이음) */
  pattern: string;
  /** topic 은 회사 기사를 뺀다 (회사 관점과 겹치지 않게) */
  exclude: string | null;
  topicName: string | null;
}

const BROAD = new Set(["ai", "인공지능", "모델", "模型", "기업", "企业", "公司", "发布", "출시", "대모델", "大模型"]);

export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function cleanTerms(terms: unknown): string[] {
  if (!Array.isArray(terms)) return [];
  const out = new Set<string>();
  for (const t of terms) {
    if (typeof t !== "string") continue;
    const s = t.trim();
    if (s.length < 2 || s.length > 30 || BROAD.has(s.toLowerCase())) continue;
    out.add(s);
  }
  return [...out];
}

/**
 * PLAN 응답 → 관점별 검색 정규식 (순수). 회사 이름이 이름표(ENTITIES)에 있으면 그 문자열 별칭을 보탠다.
 * 낱말이 2개 미만인 관점은 만들지 않는다.
 */
export function buildLensPlans(raw: unknown, story: { title: string; subject: string }): LensPlan[] {
  const r = (raw ?? {}) as { company?: { name?: string; terms?: unknown } | null; topic?: { name?: string; terms?: unknown } | null };
  const plans: LensPlan[] = [];
  let companyTerms = cleanTerms(r.company?.terms);
  const ents = findEntities(`${story.subject} ${r.company?.name ?? ""}`);
  for (const e of ents) for (const a of e.aliases) if (typeof a === "string" && a.length >= 2) companyTerms.push(a);
  companyTerms = [...new Set(companyTerms)];
  const companyPattern = companyTerms.length ? companyTerms.map(escapeRegex).join("|") : null;
  if (companyPattern && (companyTerms.length >= 2 || ents.length)) plans.push({ lens: "company", pattern: companyPattern, exclude: null, topicName: null });
  const topicTerms = cleanTerms(r.topic?.terms).filter((t) => !companyTerms.includes(t));
  if (topicTerms.length >= 2) {
    plans.push({ lens: "topic", pattern: topicTerms.map(escapeRegex).join("|"), exclude: companyPattern, topicName: (r.topic?.name ?? "").slice(0, 40) || null });
  }
  return plans;
}

// ───────────────────────── SELECT · SYNTH (시범 v0.2 그대로)

export const SELECT_SYSTEM = `오늘 기사(TODAY)와 같은 이야기 줄기에 속하는 과거 기사를 고릅니다. 관점(LENS)이 주어집니다.
- company: 같은 회사의, 오늘 기사와 같은 종류의 일(예: 오늘이 제품 출시면 앞선 제품·기능 발표, 오늘이 투자면 앞선 투자). 같은 회사라도 다른 종류의 일은 고르지 않습니다. 단, 오늘 일을 이해하는 데 꼭 필요한 배경(예: 손실 기사에 대한 앞선 매출 발표)은 고릅니다.
- topic: 다른 회사들의, 오늘 기사와 같은 주제의 중요한 앞선 사건(오늘 기사의 회사가 주인공인 기사는 고르지 않습니다). 주제 설명(TOPIC)을 따릅니다. 같은 사건을 여러 매체가 쓴 경우 하나만 고릅니다.
최대 12개, 중요한 순이 아니라 줄기를 이루는 것만. 고를 것이 2개 미만이면 빈 배열.
JSON 하나만: {"picked":["C001", ...], "thread_title":"이 줄기를 한 줄로(한국어 25자 이내)"}`;

export const SYNTH_SYSTEM = `당신은 중국 AI 뉴스 사이트의 해설 기자입니다. 오늘 기사(TODAY)를 AI를 잘 모르는 일반 독자가 이해하도록, 이 이야기가 어떻게 여기까지 왔는지를 과거 기사(PAST)만으로 정리합니다.
규칙
1. 근거는 PAST 와 TODAY 뿐. 사전 지식으로 사실·숫자·날짜를 보태지 않습니다.
2. timeline 3~6개, 오래된 순. 항목마다 date(PAST 날짜 MM-DD), text(쉬운 말 한 문장, 한국어 70자 이내), refs(PAST id 1개 이상). 같은 날 같은 사건은 한 항목.
3. 보도·추진·검토와 확정을 구분합니다("~를 추진한다고 보도됐다" / "~를 마쳤다"). 기사마다 숫자가 다르면 고치지 말고 그 기사의 숫자를 씁니다.
4. 숫자는 근거 기사 값·단위 그대로, 한 항목에 최대 2개. 환산·합산 금지.
5. background: 이 줄기를 처음 보는 독자를 위한 두 문장(150자 이내). now: 오늘 기사가 이 흐름에서 무엇이 새로운지 한 문장(TODAY 근거, 90자 이내).
6. 업계 용어·영문 약어는 풀어 씁니다. 회사·제품 이름은 한국 언론 표기. 한국어에 한자 금지. ~습니다/~됐습니다 체.
7. 기사에 없는 인과("~때문에")·평가·전망을 넣지 않습니다.
9. 영문 약어·회계·법률 용어를 쓰지 않습니다: GAAP → 회계 기준, S-1·투자설명서 → 상장 신청 서류, SEC → 미국 증권 당국, IPO → 상장, 파라미터 → 모델 크기, 오픈 웨이트 → 가중치 공개. 같은 분야 이름은 한 가지로(구현지능·체화지능 → "몸을 가진 AI(체화 지능)" 처음 한 번 뒤 "체화 지능").
10. caution: 같은 대상(예: 같은 회사의 같은 계약 금액)의 숫자가 기사마다 다르면 그 사실을 한 문장으로(예: "컴퓨팅 계약 규모는 보도마다 숫자가 다릅니다."). 없으면 "".
11. 메일은 다음 날 아침에 읽힙니다. "오늘"·"어제"를 쓰지 않습니다. 이번 기사를 가리킬 때는 "이번 기사"라고 씁니다.
8. PAST 가 2개 미만이면 {"skip": true}.
JSON 하나만: {"background":"","timeline":[{"date":"MM-DD","text":"","refs":["P01"]}],"now":"","caution":"","skip":false}`;

export interface Candidate {
  id: string;
  /** YYYY-MM-DD */
  d: string;
  s: string;
  title_kr: string;
  summary_kr: string | null;
  title_cn: string;
  summary_cn: string | null;
  title_en: string | null;
}

export function selectUserPrompt(lens: LensPlan, todayTxt: string, pool: Candidate[]): string {
  const desc = lens.lens === "company" ? "company" : `topic — TOPIC: ${lens.topicName ?? ""}`;
  return `LENS: ${desc}\n\nTODAY:\n${todayTxt}\n\nCANDIDATES:\n${pool.map((p, i) => `[${cid(i)}] ${p.d} ${p.title_kr} — ${(p.summary_kr ?? "").slice(0, 160)}`).join("\n")}`;
}

export const cid = (i: number) => `C${String(i + 1).padStart(3, "0")}`;
export const pid = (i: number) => `P${String(i + 1).padStart(2, "0")}`;

/** SELECT 응답 → 고른 후보 (오래된 순). 없는 번호는 버린다 */
export function pickedFrom(raw: unknown, pool: Candidate[]): { picked: Candidate[]; threadTitle: string } {
  const r = (raw ?? {}) as { picked?: unknown; thread_title?: unknown };
  const want = new Set(Array.isArray(r.picked) ? r.picked.filter((x): x is string => typeof x === "string") : []);
  const picked = pool.filter((_, i) => want.has(cid(i))).sort((a, b) => a.d.localeCompare(b.d));
  return { picked, threadTitle: typeof r.thread_title === "string" ? r.thread_title.trim().slice(0, 40) : "" };
}

export function synthUserPrompt(edition: string, todayTxt: string, picked: Candidate[]): string {
  return `TODAY (${edition}):\n${todayTxt}\n\nPAST:\n${picked.map((p, i) => `[${pid(i)}] ${p.d} (${p.s}) ${p.title_kr} — ${p.summary_kr ?? ""}`).join("\n")}`;
}

export interface SynthOut {
  background: string;
  timeline: { date: string; text: string; refs: string[] }[];
  now: string;
  caution: string;
  skip?: boolean;
}

const HAN_CHAR = /[一-鿿]/;

/** 시범 v0.2 코드 검사 그대로: 항목 수, 근거·날짜 대조, 숫자가 근거에 있는가, 길이, 한자 */
export function checkStory(out: SynthOut, picked: Candidate[]): string[] {
  const by = new Map(picked.map((p, i) => [pid(i), p]));
  const probs: string[] = [];
  const tl = Array.isArray(out.timeline) ? out.timeline : [];
  if (tl.length < 3 || tl.length > 6) probs.push(`항목 수 ${tl.length}`);
  for (const it of tl) {
    const refs = (Array.isArray(it.refs) ? it.refs : []).map((x) => by.get(x));
    if (!refs.length || refs.some((x) => !x)) {
      probs.push(`없는 근거 ${JSON.stringify(it.refs)}`);
      continue;
    }
    const rs = refs as Candidate[];
    if (!rs.some((p) => p.d.slice(5) === it.date)) probs.push(`날짜 ${it.date} ≠ 근거 ${rs.map((p) => p.d.slice(5)).join(",")}`);
    const src = rs.map((p) => `${p.title_kr} ${p.summary_kr ?? ""} ${p.title_cn} ${p.summary_cn ?? ""}`).join(" ");
    for (const n of String(it.text ?? "").match(/\d[\d,.]*\d|\d/g) ?? []) {
      if (!src.includes(n) && !src.replace(/,/g, "").includes(n.replace(/,/g, ""))) probs.push(`숫자 ${n} 근거에 없음 (${it.date})`);
    }
    if (String(it.text ?? "").length > 80) probs.push(`길이 ${String(it.text).length} (${it.date})`);
  }
  for (const f of ["background", "now", "caution"] as const) if (HAN_CHAR.test(String(out[f] ?? ""))) probs.push(`${f} 한자`);
  if (tl.some((it) => HAN_CHAR.test(String(it.text ?? "")))) probs.push("연대기 한자");
  // 판은 다음 날 아침 메일·사이트로 읽힌다 (2026-11-04 사용자 지적: "오늘"이 아니라 전일). 저장 행은 덮어쓰지 않으므로 여기서 막는다
  const all = [out.background, out.now, out.caution, ...tl.map((it) => it.text)].map((x) => String(x ?? "")).join(" ");
  if (/오늘|어제/.test(all)) probs.push("오늘·어제 표현");
  if (!String(out.background ?? "").trim() || !String(out.now ?? "").trim()) probs.push("배경·이번 기사 빈칸");
  return probs;
}

/** 저장 형태 (briefing_story_context 한 행) */
export interface StoryRow {
  article_id: string;
  lens: Lens;
  locale: StoryLocale;
  thread_title: string;
  background: string;
  timeline: { date: string; text: string; refs: { id: string; source: string; title: string }[] }[];
  now_text: string;
  caution: string | null;
}

const titleFor = (p: Candidate, l: StoryLocale) => (l === "ko" ? p.title_kr : l === "zh" ? p.title_cn : p.title_en || p.title_kr);

/** 검사를 통과한 SYNTH → ko 행 (근거 기사의 전체 날짜·매체·제목을 붙인다) */
export function toKoRow(articleId: string, lens: Lens, threadTitle: string, out: SynthOut, picked: Candidate[]): StoryRow {
  const by = new Map(picked.map((p, i) => [pid(i), p]));
  return {
    article_id: articleId,
    lens,
    locale: "ko",
    thread_title: threadTitle,
    background: out.background.trim(),
    timeline: out.timeline.map((it) => {
      const refs = it.refs.map((x) => by.get(x)!).filter(Boolean);
      const first = refs.find((p) => p.d.slice(5) === it.date) ?? refs[0];
      return { date: first.d, text: it.text.trim(), refs: refs.map((p) => ({ id: p.id, source: p.s, title: p.title_kr })) };
    }),
    now_text: out.now.trim(),
    caution: out.caution?.trim() || null,
  };
}

// ───────────────────────── 번역 (ko → zh·en)

export function translateSystem(target: "zh" | "en"): string {
  const lang = target === "zh" ? "简体中文" : "English";
  return `Translate the Korean values of this JSON into ${lang} for general readers of a China AI news site. Keep the JSON shape, keys and array lengths exactly; translate only string values.
- Keep every number and unit as in the source (억→${target === "zh" ? "亿" : "hundred million"}, 만→${target === "zh" ? "万" : "ten thousand"}); do not convert, round or add numbers.
- Company and product names: use NAME_GLOSSARY when given.${target === "zh" ? " Use the Chinese name for Chinese companies." : ""}
- No Korean characters in the output.${target === "en" ? " No Chinese characters." : ""}
- Plain, short sentences. Do not add facts, causes or opinions.
Return one JSON object only.`;
}

export interface TranslatableLens {
  thread_title: string;
  background: string;
  timeline: string[];
  now: string;
  caution: string;
}

export function translatable(row: StoryRow): TranslatableLens {
  return { thread_title: row.thread_title, background: row.background, timeline: row.timeline.map((t) => t.text), now: row.now_text, caution: row.caution ?? "" };
}

export function glossaryLines(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const { entry } of nameEntriesIn(text)) {
    if (entry.key === "cn_gov" || seen.has(entry.key)) continue;
    seen.add(entry.key);
    out.push(`${entry.ko.slice(0, 2).join("/") || entry.key} = ${entry.en.slice(0, 2).join("/") || "—"} = ${entry.zh.slice(0, 2).join("/") || "—"}`);
  }
  return out;
}

export function translateUserPrompt(items: TranslatableLens[], issues?: string[]): string {
  const text = items.map((x) => [x.thread_title, x.background, ...x.timeline, x.now, x.caution].join(" ")).join(" ");
  const g = glossaryLines(text);
  return `${g.length ? `NAME_GLOSSARY (ko = en = zh):\n${g.join("\n")}\n\n` : ""}${issues?.length ? `Your previous translation had these problems — fix them:\n${issues.map((i) => `- ${i}`).join("\n")}\n\n` : ""}JSON:\n${JSON.stringify({ items }, null, 1)}`;
}

function sameNumbers(src: string, out: string): boolean {
  const a = numericValues(src);
  const b = numericValues(out);
  return a.size === b.size && [...a].every((v) => b.has(v));
}

/** 번역 검사 (데일리 번역과 같은 숫자·이름 함수). 통과한 항목만 index 로 돌려준다 */
export function checkTranslated(src: TranslatableLens[], raw: unknown, target: "zh" | "en"): { ok: Map<number, TranslatableLens>; issues: string[] } {
  const items = ((raw ?? {}) as { items?: unknown }).items;
  const ok = new Map<number, TranslatableLens>();
  const issues: string[] = [];
  src.forEach((s, i) => {
    const t = Array.isArray(items) ? (items[i] as Partial<TranslatableLens> | undefined) : undefined;
    const p: string[] = [];
    if (!t || typeof t.thread_title !== "string" || typeof t.background !== "string" || typeof t.now !== "string" || !Array.isArray(t.timeline) || t.timeline.length !== s.timeline.length) {
      issues.push(`item ${i}: shape differs from source`);
      return;
    }
    const pairs: [string, string, string][] = [
      ["thread_title", s.thread_title, t.thread_title],
      ["background", s.background, t.background],
      ...s.timeline.map((x, k) => [`timeline[${k}]`, x, String(t.timeline![k] ?? "")] as [string, string, string]),
      ["now", s.now, t.now],
      ["caution", s.caution, String(t.caution ?? "")],
    ];
    for (const [f, a, b] of pairs) {
      if (a.trim() && !b.trim()) p.push(`item ${i} ${f}: empty`);
      if (HANGUL_RE.test(b)) p.push(`item ${i} ${f}: Korean characters left`);
      if (target === "en" && hasHan(b)) p.push(`item ${i} ${f}: Chinese characters in English`);
      if (!sameNumbers(a, b)) p.push(`item ${i} ${f}: numbers differ from source`);
      for (const n of nameIssues(a, b, target)) p.push(`item ${i} ${f}: ${n}`);
    }
    if (p.length) issues.push(...p);
    else ok.set(i, { thread_title: t.thread_title, background: t.background, timeline: t.timeline.map(String), now: t.now, caution: String(t.caution ?? "") });
  });
  return { ok, issues };
}

/** ko 행 + 번역 → 그 언어 행 (근거 기사 제목은 그 언어 제목) */
export function toLocaleRow(ko: StoryRow, tr: TranslatableLens, locale: "zh" | "en", titles: Map<string, { title_cn: string; title_en: string | null; title_kr: string }>): StoryRow {
  return {
    ...ko,
    locale,
    thread_title: tr.thread_title.trim(),
    background: tr.background.trim(),
    timeline: ko.timeline.map((t, k) => ({
      date: t.date,
      text: tr.timeline[k].trim(),
      refs: t.refs.map((r) => {
        const a = titles.get(r.id);
        return { ...r, title: a ? titleFor({ title_kr: a.title_kr, title_cn: a.title_cn, title_en: a.title_en } as Candidate, locale) : r.title };
      }),
    })),
    now_text: tr.now.trim(),
    caution: tr.caution.trim() || null,
  };
}
