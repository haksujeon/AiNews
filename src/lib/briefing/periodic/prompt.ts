/**
 * 주간 리포트 프롬프트 + 지표 사전(FACTS) + 이야기 후보(S01..).
 *
 * buildFacts 는 프롬프트와 화면(지표 칩)이 같이 쓴다 (Gate 2) — 화면의 칩 문자열과 LLM 이 인용한 값이 언제나 같다.
 * 이 파일은 DB 를 import 하지 않는다 (단위 테스트).
 */
import type { PeriodMetrics } from "../../metrics/period";
import type { ValidationIssue } from "../types";
import type { StoryPoolItem, WeeklyContent } from "./types";

// 프롬프트를 바꾸면 버전을 올린다 (input_hash 에 들어감)
export const WEEKLY_PROMPT_VERSION = "periodic-weekly-v1-2026-11-02";
export const WEEKLY_HEADLINE_MAX = 36;
export const WEEKLY_STORY_LIMIT = 50;

/** 지표 키 → 표시 문자열. LLM 은 이 문자열만 숫자로 쓸 수 있다 */
export function buildFacts(m: PeriodMetrics): Record<string, string> {
  const F: Record<string, string> = {};
  const v = m.volume;
  F["vol.total"] = v.display;
  F["vol.avg_complete_day"] = `하루 평균 ${v.avg_per_complete_day}건`;
  if (v.display_prev) F["vol.prev_total"] = v.display_prev;
  if (v.like_for_like) {
    F["vol.lfl"] = v.like_for_like.display;
    F["vol.lfl_change"] = v.like_for_like.display_change;
    F["vol.lfl_days"] = `${v.like_for_like.days}일`;
  }
  F["dq.incomplete_days"] = m.data_quality.incomplete_days.join(", ") || "없음";
  const withPrev = m.baseline !== null;
  for (const c of m.categories) {
    F[`cat.${c.name}`] = c.display;
    F[`cat.${c.name}.share`] = c.display_share;
    if (withPrev) {
      F[`cat.${c.name}.prev`] = `${c.prev}건`;
      F[`cat.${c.name}.chg`] = c.display_change;
    }
  }
  for (const s of m.sources) {
    F[`src.${s.name}`] = s.display;
    F[`src.${s.name}.share`] = s.display_share;
    if (withPrev) {
      F[`src.${s.name}.prev`] = `${s.prev}건`;
      F[`src.${s.name}.chg`] = s.display_change;
    }
  }
  for (const s of m.sentiment.cur) F[`sent.${s.name}`] = s.display;
  if (m.sentiment.prev) for (const s of m.sentiment.prev) F[`sent.${s.name}.prev`] = s.display;
  for (const e of m.entities) {
    F[`ent.${e.key}`] = `${e.name_ko} ${e.display}`;
    if (withPrev) {
      F[`ent.${e.key}.prev`] = `${e.name_ko} 지난주 ${e.prev}건`;
      if (e.change_pct !== null) F[`ent.${e.key}.chg`] = `${e.name_ko} ${e.display_change}`;
    }
  }
  for (const t of m.terms.top) F[`term.${t.term}`] = `${t.term} ${t.display}`;
  for (const t of m.terms.rising) F[`term.${t.term}.rise`] = `${t.term} ${t.prev}건→${t.cur}건`;
  for (const t of m.terms.falling) F[`term.${t.term}.fall`] = `${t.term} ${t.prev}건→${t.cur}건`;
  const cvo = m.china_vs_overseas;
  F["cvo.china"] = `중국 실체가 나온 기사 ${cvo.cur.china_pct}%`;
  F["cvo.foreign"] = `해외 실체가 나온 기사 ${cvo.cur.foreign_pct}%`;
  if (cvo.prev) {
    F["cvo.china.prev"] = `지난주 중국 ${cvo.prev.china_pct}%`;
    F["cvo.foreign.prev"] = `지난주 해외 ${cvo.prev.foreign_pct}%`;
  }
  F["stories.multi_source"] = `${m.stories.event_multi_source_count}건`;
  return F;
}

/** 이야기 후보: 매체 수·점수 상위 묶음 + 돈 흐름 표 기사 (S01..) */
export function buildStoryPool(
  stories: { ids: string[]; title_kr: string; summary_kr: string; sources: string[]; days: string[]; entities: string[] }[],
  money: PeriodMetrics["money_table"],
  limit = WEEKLY_STORY_LIMIT
): StoryPoolItem[] {
  const pool: Omit<StoryPoolItem, "sid">[] = [];
  const seen = new Set<string>();
  for (const g of stories.slice(0, limit)) {
    pool.push({ ids: g.ids, title_kr: g.title_kr, summary_kr: g.summary_kr, sources: g.sources, days: g.days, entities: g.entities });
    g.ids.forEach((i) => seen.add(i));
  }
  for (const r of money) {
    if (seen.has(r.id)) continue;
    pool.push({ ids: [r.id], title_kr: r.title_kr, summary_kr: "", sources: [r.source], days: [r.day], entities: r.entities });
    seen.add(r.id);
  }
  return pool.map((p, i) => ({ ...p, sid: `S${String(i + 1).padStart(2, "0")}` }));
}

const SCHEMA = `{
 "headline": "이번 주를 한 줄로, 공백 포함 ${WEEKLY_HEADLINE_MAX}자 이내 (엄수)",
 "dek": "이번 주 핵심 2~3문장, 220자 이내", "dek_refs": ["S.."], "dek_metrics": ["key.."],
 "big_picture": [ {"title":"흐름 이름 24자 이내","text":"무엇이 바뀌었고 왜 중요한가 2~3문장 240자 이내","refs":["S..",...],"metrics":["key.."]} ],  // 3~4개
 "movers": [ {"entity":"ent 키 (예: anthropic)","text":"이 기업이 이번 주 무엇을 했나 90자 이내","refs":["S.."],"metrics":["ent.키"]} ],  // 3~4개
 "money": {"text":"돈 흐름 요약 200자 이내 (MONEY 표의 금액만, 합산 금지)","refs":["S.."]},
 "china_lens": {"text":"중국 매체가 본 중국 vs 해외 구도 200자 이내","refs":["S.."],"metrics":["key.."]},
 "watch_next": [ {"text":"다음에 지켜볼 것 70자 이내 (기사에 예정·계획으로 나온 것만)","refs":["S.."]} ],  // 2~3개
 "term": {"term":"TERMS 의 중국어 용어 그대로","why":"왜 이 용어가 이번 주의 말인가 80자 이내","metrics":["term.용어"]}
}`;

export function buildWeeklySystemPrompt(): string {
  return `당신은 '중국 AI 뉴스' 사이트의 주간 리포트 편집자입니다. 하루치 뉴스를 다시 나열하지 말고, 한 주 동안 무엇이 바뀌었는지(흐름·이동·돈·구도)를 한국 독자에게 종합합니다.

절대 규칙 (위반 시 폐기)
1. 근거는 FACTS(지표)와 STORIES(기사 묶음)뿐입니다. 사전 지식으로 사실·수치·날짜를 보태지 마십시오.
2. 모든 숫자는 (a) metrics 에 적은 FACTS 키의 값 문자열 또는 (b) refs 기사 제목·요약에 나온 값과 단위를 그대로 씁니다. 백분율·증감·합계·평균을 직접 계산하지 마십시오. 금액을 합산하지 마십시오.
3. 모든 항목에 refs 를 1개 이상 답니다(term 제외). big_picture 의 각 흐름은 refs 3개 이상이거나 metrics 1개 이상이어야 합니다.
4. 문장에 나오는 기업·인물·제품 이름은 refs 기사에 나와야 합니다.
5. 물량(기사 수) 증감을 말할 때는 반드시 vol.lfl_change 같은 FACTS 키를 쓰고, DATA_QUALITY 의 수집 미완 날짜를 언급하지 않는 한 vol.total 과 vol.prev_total 을 직접 비교하지 마십시오.
6. 언급 건수는 "중국 매체가 다룬 기사 수"입니다. 시장 점유율·인기·실적으로 해석하지 마십시오("언급이 늘었다"는 OK, "영향력이 커졌다"는 근거가 있을 때만).
7. 중국 중심: big_picture 중 2개 이상은 중국 기업·기관·시장이 주체인 흐름이어야 합니다. 해외 기업 이야기는 중국 매체의 시각이나 중국 영향으로 씁니다.
8. 한국어 문장에 한자를 쓰지 마십시오(term.term 만 예외). 과장·추측·투자 권유 금지. 간결한 평서문(~했다, ~이다).
9. 순위·배수·"최대/최초" 같은 서열 표현은 기사에 그 표현이 그대로 있을 때만 씁니다. 통화가 다른 금액끼리 크기를 비교하지 마십시오.
10. 증감("늘었다·줄었다")을 말하면 그 증감을 담은 FACTS 키(.chg / .rise / .fall / vol.lfl_change)를 metrics 에 넣고, 지표의 방향(+/-, 늘어난 용어/줄어든 용어)과 같은 방향으로 씁니다.
11. metrics 에 넣는 지표의 대상(기업·매체·용어)은 그 문장에 나와야 합니다.
12. headline 은 공백 포함 ${WEEKLY_HEADLINE_MAX}자 이내입니다(넘으면 반려). 쓰고 나서 글자 수를 세어 보십시오.
13. money 는 MONEY 표에 있는 금액과 그 행의 유형(투자·상장·부채 조달 등)만 씁니다. 매출·기업가치를 거래 금액처럼 쓰지 마십시오.

출력: 아래 스키마의 JSON 하나만. 코드 펜스·설명 금지.
${SCHEMA}`;
}

export function buildWeeklyUserPrompt(m: PeriodMetrics, facts: Record<string, string>, pool: StoryPoolItem[]): string {
  const sidOf = new Map(pool.flatMap((p) => p.ids.map((id) => [id, p.sid] as const)));
  const dq = m.data_quality.incomplete_days.length
    ? `${m.data_quality.incomplete_days.join(", ")} 수집 미완(같은 요일군 중앙값의 50% 미만) — 지난주 대비 물량 비교에서 제외`
    : "결손 없음";
  const period = `${m.period.start} ~ ${m.period.end} (월~일, 베이징 날짜)${m.baseline ? `. 비교 기준: 지난주 ${m.baseline.start} ~ ${m.baseline.end}` : ""}`;
  return `PERIOD: ${period}
DATA_QUALITY: ${dq}
FACTS (key = 값 문자열):
${Object.entries(facts)
  .map(([k, x]) => `${k} = ${x}`)
  .join("\n")}

MONEY (제목에 나온 거래 금액, 합산 금지):
${m.money_table.map((r) => `${sidOf.get(r.id) ?? "?"} | ${r.day} | ${r.kind} | ${r.amount} | ${r.title_kr}`).join("\n")}

STORIES (${pool.length}건, sources = 함께 다룬 매체):
${pool
  .map((p) =>
    JSON.stringify({ id: p.sid, sources: p.sources, days: p.days, ent: p.entities, title_kr: p.title_kr, summary_kr: (p.summary_kr || "").slice(0, 200) })
  )
  .join("\n")}`;
}

export function buildWeeklyRepairPrompt(draft: WeeklyContent, problems: ValidationIssue[], extra: string[]): string {
  const lines = [...problems.map((f) => `- [${f.rule}] ${f.path}: ${f.detail}`), ...extra.map((e) => `- ${e}`)].join("\n");
  return `아래 JSON 은 당신이 방금 쓴 주간 리포트입니다. 자동 검증에서 다음 문제가 나왔습니다.

${lines}

문제가 된 항목만 고쳐서 같은 스키마의 JSON 전체를 다시 출력하십시오.
- 근거에 없는 숫자·기업명·서열 표현은 FACTS 값이나 refs 기사에 나온 표현으로 바꾸거나 문장에서 뺍니다.
- 증감을 말하는 문장에는 그 증감 FACTS 키를 metrics 에 넣고, 지표 방향과 반대되는 표현("줄었는데 열풍")을 고칩니다.
- 물량 비교는 vol.lfl_change 로만 합니다. 통화가 다른 금액끼리 크기를 비교하지 않습니다.
- metrics 에 넣은 지표의 대상이 문장에 없으면 그 지표를 빼거나 문장에 대상을 씁니다.
- headline 이 ${WEEKLY_HEADLINE_MAX}자를 넘었다면 뜻을 유지한 채 ${WEEKLY_HEADLINE_MAX}자 이내로 다시 씁니다.
- 한국어 문장의 한자는 한국어 표기로 바꿉니다 (term.term 만 예외).
- 문제가 없는 항목은 그대로 둡니다. 코드 펜스·설명 없이 JSON 하나만 출력합니다.

${JSON.stringify(draft)}`;
}

// ───────────────────────── 결정적 대체 문장 (검증에서 빠진 headline·dek)

const md = (d: string) => `${Number(d.slice(5, 7))}월 ${Number(d.slice(8, 10))}일`;

/** dek 대체: 지표만으로 쓴 문장. 숫자는 모두 FACTS 값 그대로 */
export function fallbackDek(m: PeriodMetrics): { text: string; metrics: string[] } {
  const top = m.entities.slice(0, 3);
  const lfl = m.volume.like_for_like;
  const parts = [`${md(m.period.start)}~${md(m.period.end)} 공개 AI 기사 ${m.volume.display}을 종합했다.`];
  const metrics = ["vol.total"];
  if (lfl) {
    parts.push(`같은 요일끼리 비교한 기사 수는 지난주 대비 ${lfl.display_change}였다.`);
    metrics.push("vol.lfl_change");
  }
  if (top.length) {
    parts.push(`가장 많이 다뤄진 기업은 ${top.map((e) => `${e.name_ko} ${e.display}`).join(", ")}이었다.`);
    metrics.push(...top.map((e) => `ent.${e.key}`));
  }
  return { text: parts.join(" "), metrics };
}

/** headline 대체 */
export function fallbackHeadline(m: PeriodMetrics): string {
  const top = m.entities[0];
  return top ? `이번 주 중국 AI 보도, ${top.name_ko} 언급 최다` : "이번 주 중국 AI 흐름";
}
