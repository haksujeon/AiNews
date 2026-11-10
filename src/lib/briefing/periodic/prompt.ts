/**
 * 주간·월간 리포트 프롬프트 + 지표 사전(FACTS) + 이야기 후보(S01..). 주간과 월간은 같은 함수에 kind 만 다르다 (Gate 2).
 *
 * buildFacts 는 프롬프트와 화면(지표 칩)이 같이 쓴다 (Gate 2) — 화면의 칩 문자열과 LLM 이 인용한 값이 언제나 같다.
 * 이 파일은 DB 를 import 하지 않는다 (단위 테스트).
 */
import { BACKFILL_CAPS, type PeriodMetrics } from "../../metrics/period";
import type { ValidationIssue } from "../types";
import { groupPeriodStories, type PeriodStoryInput } from "../select";
import { chinaByRegion, moneyIssues, type SourceDoc } from "../rules";
import type { PeriodicKind, StoryPoolItem, WeeklyContent } from "./types";

// 프롬프트를 바꾸면 버전을 올린다 (input_hash 에 들어감)
// weekly v3 / monthly v2 (2026-11-02 편집 QA): 사건 단위 후보, MONEY 표에서 매출·가치·통화 불일치 행 제외,
//   금액 서열 금지, "가장 많이" 는 지표 1위만, 매체 수 그대로, 수리 지시문 금지
// weekly v4 / monthly v3: 중국 주체 = 근거 기사 대상 지역(subject_region) — STORIES 에 region(사건 기사 지역 다수결)·cn 표시
// weekly v5 / monthly v4 (재감사 round 2): MONEY 의 같은 거래(통화만 다름)는 한 행, 기간 밖 거래 제외(지표 v4),
//   월간 WEEK_STORIES — month_arc 의 refs 는 그 주의 사건만, 증감·쏠림 표현('열풍·확산·몰리')도 증감 지표 필요
// weekly v6 / monthly v5: 수리 지시 — 방향 충돌 문장은 지우거나 FACTS 값을 그대로 인용 (사실 뒤집기 금지)
// weekly v7 / monthly v6 (2026-11-10 사용자 결정 "쉽게 설명해 준다"): 큰 흐름마다 easy(쉽게 말하면)·why(왜 중요할까) —
//   기사 쉽게 풀어보기와 같은 눈높이(초등 5~6학년·해요체·비유 하나·숫자 없음), text 는 사실만, 업계 용어 풀어 쓰기,
//   기업 칸은 "언급이 늘었다"가 아니라 그 기간에 한 일
export const WEEKLY_PROMPT_VERSION = "periodic-weekly-v7.1-2026-11-11";
// v7.1 (2026-11-11 실제 AI 검토 시험): why 의 "기사는 ~라고 봐요"는 기사에 그 판단이 있을 때만 (W45 시험에서 사례 묶음을 추세로 쓴 1문장이 overclaim)
// monthly v7 (2026-11-10 사용자 결정 "월간 다시 짜기"): 주간 합본 — 그달에 발행된 주간 리포트(WEEKLY_REPORTS)를 바탕으로,
//   근거 후보는 주간판이 인용한 사건(+돈 흐름 표)만. 주간판에 없는 새 사건을 큰 흐름으로 세우지 않는다
export const MONTHLY_PROMPT_VERSION = "periodic-monthly-v7.1-2026-11-11";
/** 월간을 만들 수 있는 최소 발행 주간 리포트 수 */
export const MONTHLY_MIN_WEEKLIES = 2;
export const WEEKLY_HEADLINE_MAX = 36;
export const WEEKLY_STORY_LIMIT = 50;
export const MONTHLY_STORY_LIMIT = 60;

export const PROMPT_VERSION: Record<PeriodicKind, string> = { weekly: WEEKLY_PROMPT_VERSION, monthly: MONTHLY_PROMPT_VERSION };
export const STORY_LIMIT: Record<PeriodicKind, number> = { weekly: WEEKLY_STORY_LIMIT, monthly: MONTHLY_STORY_LIMIT };

/** 기간 낱말 (프롬프트·지표 문자열). 주간 = 주, 월간 = 달 */
const WORDS: Record<PeriodicKind, { cur: string; prev: string; span: string; name: string; next: string }> = {
  weekly: { cur: "이번 주", prev: "지난주", span: "한 주", name: "주간", next: "다음 주" },
  monthly: { cur: "이번 달", prev: "지난달", span: "한 달", name: "월간", next: "다음 달" },
};
export const kindOfMetrics = (m: PeriodMetrics): PeriodicKind => (m.kind === "monthly" ? "monthly" : "weekly");

/** 연속 날짜를 "2026-10-01~2026-10-12" 범위로 묶는다 */
export function compactDays(days: string[]): string {
  const out: string[] = [];
  let s = 0;
  for (let i = 1; i <= days.length; i++) {
    const contiguous = i < days.length && Date.parse(`${days[i]}T00:00:00Z`) - Date.parse(`${days[i - 1]}T00:00:00Z`) === 86_400_000;
    if (contiguous) continue;
    out.push(s === i - 1 ? days[s] : `${days[s]}~${days[i - 1]}`);
    s = i;
  }
  return out.join(", ");
}

/** 지표 키 → 표시 문자열. LLM 은 이 문자열만 숫자로 쓸 수 있다 */
export function buildFacts(m: PeriodMetrics): Record<string, string> {
  const F: Record<string, string> = {};
  const W = WORDS[kindOfMetrics(m)];
  const v = m.volume;
  F["vol.total"] = v.display;
  // 수집이 완전한 날이 하루도 없으면 하루 평균을 싣지 않는다 (0건으로 읽힘)
  if (v.daily.some((d) => !d.incomplete)) F["vol.avg_complete_day"] = `하루 평균 ${v.avg_per_complete_day}건`;
  if (v.display_prev) F["vol.prev_total"] = v.display_prev;
  if (m.kind === "monthly" && v.prev_avg_per_complete_day && v.prev_daily.some((d) => !d.incomplete))
    F["vol.prev_avg_complete_day"] = `${W.prev} 하루 평균 ${v.prev_avg_per_complete_day}건`;
  // 같은 요일 비교: 비교할 수 있는 요일이 하나도 없으면 싣지 않는다
  if (v.like_for_like && v.like_for_like.days > 0) {
    F["vol.lfl"] = v.like_for_like.display;
    F["vol.lfl_change"] = v.like_for_like.display_change;
    F["vol.lfl_days"] = `${v.like_for_like.days}일`;
  }
  const dq = m.data_quality;
  F["dq.incomplete_days"] = compactDays(dq.incomplete_days) || "없음";
  if (dq.reduced_days?.length) F["dq.reduced_days"] = `${compactDays(dq.reduced_days)} (${dq.reduced_days.length}일, 보충 수집 상한)`;
  if (dq.partial_days?.length) F["dq.partial_days"] = compactDays(dq.partial_days);
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
      F[`ent.${e.key}.prev`] = `${e.name_ko} ${W.prev} ${e.prev}건`;
      if (e.change_pct !== null) F[`ent.${e.key}.chg`] = `${e.name_ko} ${e.display_change}`;
    }
  }
  for (const t of m.terms.top) F[`term.${t.term}`] = `${t.term} ${t.display}`;
  for (const t of m.terms.rising) F[`term.${t.term}.rise`] = `${t.term} ${t.prev}건→${t.cur}건`;
  for (const t of m.terms.falling) F[`term.${t.term}.fall`] = `${t.term} ${t.prev}건→${t.cur}건`;
  // v3: 대표 지역 기준 (region_share). 예전 스냅숏(v2)은 언급 기준 china_vs_overseas.
  const rs = m.region_share;
  if (rs) {
    F["region.cn"] = `대표 지역이 중국인 기사 ${rs.cur.cn_pct}%`;
    F["region.us"] = `대표 지역이 미국인 기사 ${rs.cur.us_pct}%`;
    F["region.other"] = `대표 지역이 그 밖(글로벌 포함)인 기사 ${rs.cur.other_pct}%`;
    F["region.us_china"] = `미중이 함께 중심인 기사 ${rs.cur.us_china}건`;
    if (rs.prev) {
      F["region.cn.prev"] = `${W.prev} 중국 ${rs.prev.cn_pct}%`;
      F["region.us.prev"] = `${W.prev} 미국 ${rs.prev.us_pct}%`;
    }
  }
  const cvo = m.china_vs_overseas;
  if (!rs && cvo) {
    F["cvo.china"] = `중국 실체가 나온 기사 ${cvo.cur.china_pct}%`;
    F["cvo.foreign"] = `해외 실체가 나온 기사 ${cvo.cur.foreign_pct}%`;
    if (cvo.prev) {
      F["cvo.china.prev"] = `${W.prev} 중국 ${cvo.prev.china_pct}%`;
      F["cvo.foreign.prev"] = `${W.prev} 해외 ${cvo.prev.foreign_pct}%`;
    }
  }
  F["stories.multi_source"] = `${m.stories.event_multi_source_count}건`;
  // 월간: 주별 궤적. 원 건수(.total)는 주 길이·수집 축소가 달라 비교용이 아니다 → 비교는 .weekday_avg / .per1k
  for (const w of m.weeks ?? []) {
    const tag = w.coverage === "reduced" ? " (축소 수집)" : w.coverage === "partial" ? " (부분 수집 포함)" : "";
    F[`week.${w.key}.total`] = `${w.key} ${w.total}건${tag}`;
    if (w.weekday_avg !== null) F[`week.${w.key}.weekday_avg`] = `${w.key} 평일 하루 평균 ${w.weekday_avg}건`;
    for (const [k, n] of Object.entries(w.entities)) {
      const nm = m.entities.find((e) => e.key === k)?.name_ko ?? k;
      F[`week.${w.key}.ent.${k}`] = `${nm} ${w.key} ${n}건`;
      F[`week.${w.key}.ent.${k}.per1k`] = `${nm} ${w.key} 1천 건당 ${w.entities_per_1k[k] ?? 0}건`;
    }
  }
  return F;
}

type PoolStory = { ids: string[]; title_kr: string; summary_kr: string; sources: string[]; days: string[]; entities: string[] } & Partial<
  Pick<PeriodStoryInput, "primary_id" | "title_cn" | "score">
>;

/**
 * 이야기 후보: 매체 수·점수 상위 사건 + 돈 흐름 표 기사 (S01..).
 * 같은 사건을 다른 날·다른 글로 다룬 묶음(1단계)은 2단계 사건 묶기(select.ts groupPeriodStories, 지표 events 와 같은 함수)로
 * 하나의 후보로 합친다 — 같은 이야기가 두 후보로 나뉘어 본문에 두 번 나오지 않게 (QA 권고 5).
 * 대표 제목·요약은 점수가 가장 높은 묶음, ids·sources·days 는 사건 전체.
 */
export function buildStoryPool(stories: PoolStory[], money: PeriodMetrics["money_table"], limit: number = WEEKLY_STORY_LIMIT): StoryPoolItem[] {
  const pool: Omit<StoryPoolItem, "sid">[] = [];
  const seen = new Set<string>();
  const inputs = stories.map((g, i) => ({
    ...g,
    primary_id: g.primary_id ?? g.ids[0] ?? String(i),
    title_cn: g.title_cn ?? "",
    score: g.score ?? 0,
  }));
  const events = groupPeriodStories(inputs);
  for (const ev of events.slice(0, limit)) {
    const lead = ev.lead;
    pool.push({
      ids: ev.ids,
      title_kr: lead.title_kr,
      summary_kr: lead.summary_kr,
      sources: ev.sources,
      days: ev.days,
      entities: [...new Set(ev.members.flatMap((x) => x.entities))],
    });
    ev.ids.forEach((i) => seen.add(i));
  }
  for (const r of money) {
    if (seen.has(r.id)) continue;
    // 같은 거래를 다른 통화로 쓴 기사(same_deal)도 같은 후보로 (한 거래 = 한 S id)
    const same = (r.same_deal ?? []).filter((x) => !seen.has(x.id));
    pool.push({
      ids: [r.id, ...same.map((x) => x.id)],
      title_kr: r.title_kr,
      summary_kr: "",
      sources: [...new Set([r.source, ...same.map((x) => x.source)])],
      days: [...new Set([r.day, ...same.map((x) => x.day)])].sort(),
      entities: r.entities,
    });
    seen.add(r.id);
    same.forEach((x) => seen.add(x.id));
  }
  return pool.map((p, i) => ({ ...p, sid: `S${String(i + 1).padStart(2, "0")}` }));
}

function schema(kind: PeriodicKind, weekKeys: string[]): string {
  const W = WORDS[kind];
  const arc =
    kind === "monthly"
      ? `
 "month_arc": [ {"week":"${weekKeys.join("|")}","text":"그 주의 흐름 한 문장 90자 이내","refs":["WEEK_STORIES 에서 그 주의 S.. 만"],"metrics":["week.W.. 키"]} ],  // 주마다 1개, ${weekKeys.length}개`
      : "";
  return `{
 "headline": "${W.cur}를 한 줄로, 공백 포함 ${WEEKLY_HEADLINE_MAX}자 이내 (엄수)",
 "dek": "${W.cur} 핵심 2~3문장, 220자 이내", "dek_refs": ["S.."], "dek_metrics": ["key.."],
 "big_picture": [ {"title":"흐름 이름 24자 이내 (쉬운 말)","text":"무슨 일이 있었나 — 사실 2~3문장 240자 이내","easy":"쉽게 말하면 — 해요체 2~3문장 90~170자","why":"왜 중요할까 — 해요체 1~2문장 60~130자","key":{"value":"이 흐름을 대표하는 숫자 하나 — text 에 쓴 표기 그대로 (예: 48.1%, 110억 달러, 135대)","label":"무엇의 숫자인지 14자 이내 (예: 수학 시험 점수)"},"refs":["S..",...],"metrics":["key.."]} ],  // 3~4개${arc}
 "movers": [ {"entity":"ent 키 (예: anthropic)","text":"이 기업이 ${W.cur} 한 일(사건) 90자 이내 — '언급이 늘었다·줄었다'로 시작하지 말 것","refs":["S.."],"metrics":["ent.키"]} ],  // 3~4개
 "money": {"text":"돈 흐름 요약 200자 이내 (MONEY 표의 금액만, 합산 금지)","refs":["S.."]},
 "china_lens": {"text":"중국 매체가 본 중국 vs 해외 구도 200자 이내","refs":["S.."],"metrics":["key.."]},
 "watch_next": [ {"text":"${W.next}에 지켜볼 것 70자 이내 (기사에 예정·계획으로 나온 것만)","refs":["S.."]} ],  // 2~3개
 "term": {"term":"TERMS 의 중국어 용어 그대로","why":"왜 이 용어가 ${W.cur}의 말인가 80자 이내","metrics":["term.용어"]}
}`;
}

/** 주간 시스템 프롬프트 (예전 이름) */
export function buildWeeklySystemPrompt(): string {
  return buildPeriodicSystemPrompt("weekly");
}

export function buildPeriodicSystemPrompt(kind: PeriodicKind, weekKeys: string[] = []): string {
  const W = WORDS[kind];
  const volumeRule =
    kind === "weekly"
      ? `5. 물량(기사 수) 증감을 말할 때는 반드시 vol.lfl_change 같은 FACTS 키를 쓰고, DATA_QUALITY 의 수집 미완 날짜를 언급하지 않는 한 vol.total 과 vol.prev_total 을 직접 비교하지 마십시오. vol.lfl_change 가 FACTS 에 없으면 ${W.prev} 대비 물량 증감을 말하지 마십시오.`
      : `5. 주별 기사 수를 비교할 때는 week.W..weekday_avg(수집이 완전한 평일 평균)만 쓰고, week.W..total 원 건수끼리 비교하지 마십시오. 기업의 주별 변화는 week.W..ent.키.per1k(기사 1천 건당)로만 말하십시오. 지난달 비교는 FACTS 에 .prev 키가 있을 때만 합니다.`;
  return `당신은 '중국 AI 뉴스' 사이트의 ${W.name} 리포트 편집자입니다. 하루치 뉴스를 다시 나열하지 말고, ${W.span} 동안 무엇이 바뀌었는지(흐름·이동·돈·구도)를 한국 독자에게 종합합니다.

절대 규칙 (위반 시 폐기)
1. 근거는 FACTS(지표)와 STORIES(기사 묶음)뿐입니다. 사전 지식으로 사실·수치·날짜를 보태지 마십시오.
2. 모든 숫자는 (a) metrics 에 적은 FACTS 키의 값 문자열 또는 (b) refs 기사 제목·요약에 나온 값과 단위를 그대로 씁니다. 백분율·증감·합계·평균을 직접 계산하지 마십시오. 금액을 합산하지 마십시오.
3. 모든 항목에 refs 를 1개 이상 답니다(term 제외). big_picture 의 각 흐름은 refs 3개 이상이거나 metrics 1개 이상이어야 합니다.
4. 문장에 나오는 기업·인물·제품 이름은 refs 기사에 나와야 합니다.
${volumeRule}
6. 언급 건수는 "중국 매체가 다룬 기사 수"입니다. 시장 점유율·인기·실적으로 해석하지 마십시오("언급이 늘었다"는 OK, "영향력이 커졌다"는 근거가 있을 때만).
7. 중국 중심: big_picture 중 2개 이상은 중국 기업·기관·시장이 주체인 흐름이어야 합니다. "중국 주체"는 refs 사건의 region(기사 대상 지역)이 CN 인 것입니다(STORIES 의 cn:true, 대만·홍콩 기사도 CN). 중국 흐름의 refs 는 cn:true 사건 위주로 답니다. 해외 기업 이야기는 중국 매체의 시각이나 중국 영향으로 씁니다.
8. 한국어 문장에 한자를 쓰지 마십시오(term.term 만 예외). 과장·추측·투자 권유 금지. 간결한 평서문(~했다, ~이다).
9. 순위·배수·"최대/최초" 같은 서열 표현은 기사에 그 표현이 그대로 있을 때만 씁니다. 통화가 다른 금액끼리 크기를 비교하지 마십시오.
10. 증감("늘었다·줄었다")을 말하면 그 증감을 담은 FACTS 키(.chg / .rise / .fall / vol.lfl_change / week.*)를 metrics 에 넣고, 지표의 방향(+/-, 늘어난 용어/줄어든 용어)과 같은 방향으로 씁니다.
11. metrics 에 넣는 지표의 대상(기업·매체·용어)은 그 문장에 나와야 합니다.
12. headline 은 공백 포함 ${WEEKLY_HEADLINE_MAX}자 이내입니다(넘으면 반려). 쓰고 나서 글자 수를 세어 보십시오.
13. money 는 MONEY 표에 있는 금액과 그 행의 유형(투자·상장·부채 조달 등)만 씁니다. 매출·기업가치·손실 금액을 "확보·유치·조달" 처럼 거래 금액으로 쓰지 마십시오. 금액끼리 크기를 비교하거나 서열을 매기지 마십시오("최대 거래", "가장 큰", "상대적으로 작았다" 금지 — 같은 통화여도).
14. DATA_QUALITY 의 축소 수집일(보충 수집, 매체별 하루 상한)과 부분 수집일의 기사 수는 실제 보도량이 아닙니다. 그 날·그 주의 기사 수가 적다는 사실로 관심이 줄었다거나 늘었다고 추론하지 마십시오.
15. "가장 많이 늘었다·가장 많이 다뤄졌다·언급 최다" 같은 순위 표현은 FACTS 의 1위(용어는 .rise 의 첫째, 기업은 ent 언급 수 첫째)에만 씁니다. dek·term.why·china_lens 도 증감을 말하면 그 증감 키를 metrics 에 넣고, 용어를 한국어로 옮겨 써도(智能体 → 에이전트) 지표 방향과 같아야 합니다.
16. "두 매체가 전했다" 처럼 매체 수를 말할 때는 refs 의 sources 수 그대로 씁니다. china_lens 에서 "국내 기업 위주·해외 기업 위주" 는 cvo.china / cvo.foreign 값이 큰 쪽으로만 씁니다.
17. "주도·주류·재편·가열·이동" 같은 추세 단정과 "최초·최대·역대" 는 기사에 그 표현이 있을 때만, 기사가 "전망·가능성·중 하나" 로 한정했으면 한정을 그대로 씁니다.
18. STORIES 는 사건 단위입니다(같은 사건의 여러 날·여러 글이 한 id). 매체 수(sources)가 가장 많은 사건 1·2위는 big_picture 나 movers 에 반영합니다. 같은 사건을 두 항목에 나눠 쓰지 마십시오.
19. "열풍·붐·쏠림·확산·몰리다" 도 증감 주장입니다 — 증감 FACTS 키(.chg/.rise/.fall/vol.lfl_change/week.*)가 없으면 쓰지 마십시오. 기사의 숫자("호출량 801% 급증")로 말하는 증감은 그 기사 표현 그대로 쓰고, 언급 수 지표와 섞지 마십시오.
20. MONEY 의 한 행은 거래 하나입니다. "(= …, 같은 거래)" 로 붙은 다른 통화 금액은 같은 거래이므로 두 거래로 나열하지 마십시오.${
    kind === "monthly"
      ? "\n21. month_arc 의 각 주 refs 에는 WEEK_STORIES 에 그 주로 나온 S id 만 넣습니다(다른 주 사건 금지)." +
        "\n22. 이 월간 리포트는 그달에 이미 검토·발행된 주간 리포트(WEEKLY_REPORTS)의 합본입니다. big_picture 는 여러 주에 걸친 흐름을 WEEKLY_REPORTS 에서 골라 한 달 단위로 묶고, month_arc 의 각 주 문장은 그 주 주간 리포트의 흐름을 줄여 씁니다. WEEKLY_REPORTS 에 없는 새 사건을 큰 흐름으로 세우지 마십시오. 숫자·근거는 언제나 FACTS·STORIES 로 답니다(WEEKLY_REPORTS 는 근거가 아니라 길잡이)."
      : ""
  }

쉽게 설명하기 (이 사이트의 강점 — 독자는 AI 업계 사람이 아닙니다)
E1. 사실 칸(headline·dek·big_picture.text·movers·money·china_lens·watch_next)도 업계 용어를 그대로 두지 않습니다. 파라미터·토큰·추론·에이전트·벤치마크·가중치 같은 말은 쉬운 말로 바꾸거나 바로 뒤 괄호에 짧은 풀이를 붙입니다. 시험·모델 이름은 무엇인지 한마디를 붙입니다("수학 문제 시험 MATH-500").
E2. movers.text 는 그 기업이 ${W.cur} 한 일을 사건으로 씁니다. "언급이 늘었다·줄었다"로 문장을 시작하지 마십시오. 언급 수는 사건 뒤에 덧붙일 때만, ent 지표 값 그대로 씁니다.
E3. big_picture.easy("쉽게 말하면"): 초등학교 5~6학년도 이해하도록 이 흐름이 '무슨 뜻'인지 설명합니다. text 의 사실(누가·언제·숫자)을 되풀이하지 않습니다. 낯선 개념에는 아이가 아는 것(학교·집·놀이·가게·운동)에 빗댄 비유를 하나만 씁니다. 비유가 맞지 않거나 뜻을 틀리게 만들면 비유 없이 쉬운 말로만 씁니다.
E4. big_picture.why("왜 중요할까"): 이 흐름으로 사람들(우리 생활, 일하는 사람, 회사, 나라)에게 무엇이 달라질 수 있는지를 기사가 말하는 범위 안에서 씁니다. "기사는 ~라고 봐요"는 refs 기사에 그 판단 문장이 그대로 있을 때만 씁니다 — 여러 사례를 묶어 "방식이 바뀌고 있다·추세다"처럼 기사에 없는 흐름을 기사 판단으로 만들지 마십시오. 기사가 하지 않은 예측·평가·업계 전체 이야기를 지어내지 않습니다. 확실하지 않으면 그 사건 하나로 무엇이 달라질 수 있는지만 씁니다.
E5. easy·why 공통: 친근한 해요체, 쉬운 우리말. 숫자를 쓰지 않습니다. 한자를 쓰지 않습니다. 영어 약어(AI 제외)는 쓰지 않거나 바로 뒤 괄호에 쉬운 풀이를 붙입니다. 회사·제품 이름은 text 에 쓴 표기 그대로, 새 이름·새 사실·새 원인을 보태지 않습니다. 해요체는 easy·why 에만 쓰고 나머지 칸은 평서문(~했다)입니다.
E6. big_picture.key 는 한눈에 보기 칸에 크게 보일 숫자입니다. value 는 그 흐름의 text 에 쓴 숫자를 표기 그대로 옮기고(새 숫자 금지), label 은 독자가 바로 알아듣는 짧은 우리말로 씁니다. 대표할 숫자가 없으면 key 를 빼십시오.

출력: 아래 스키마의 JSON 하나만. 코드 펜스·설명 금지.
${schema(kind, weekKeys)}`;
}

/** 프롬프트의 DATA_QUALITY 줄 (화면 데이터 알림과 같은 구분: 축소 수집 / 부분 수집) */
export function dataQualityLine(m: PeriodMetrics): string {
  const W = WORDS[kindOfMetrics(m)];
  const dq = m.data_quality;
  const reduced = dq.reduced_days ?? [];
  // 예전 스냅숏(reduced/partial 구분 전)은 incomplete_days 가 모두 부분 수집
  const partial = dq.partial_days ?? dq.incomplete_days;
  const parts: string[] = [];
  if (reduced.length) {
    const caps = Object.entries(BACKFILL_CAPS)
      .map(([s, n]) => `${s} ≤${n}건`)
      .join(", ");
    parts.push(`${compactDays(reduced)} 축소 수집(보충 수집, 매체별 하루 상한 ${caps}) — 기사 수가 실제 보도량보다 훨씬 적다`);
  }
  if (partial.length) parts.push(`${compactDays(partial)} 부분 수집(같은 요일군 중앙값의 50% 미만)`);
  if (!parts.length) return "결손 없음";
  const cmp = m.baseline ? `${W.prev} 대비 물량 비교에서 제외` : "비교 기간 없음";
  return `${parts.join("; ")} — ${cmp}. 이 날들의 기사 수로 추세를 추론하지 말 것`;
}

/**
 * MONEY 표 행의 금액이 거래 금액인가 — 검증기(moneyIssues)와 같은 함수로 본다 (Gate 2).
 *  value: 원문에서 그 금액은 매출·기업가치·손실 (Anthropic "반년 만에 163억 달러 확보" = 상반기 매출)
 *  currency: 중국어 원문의 통화가 다름 ("최대 110억 달러" ← 最大一笔110亿 = 위안)
 */
export function moneyRowProblem(row: PeriodMetrics["money_table"][number], docs: SourceDoc[]): "value" | "currency" | null {
  if (!docs.length) return null;
  const issues = moneyIssues(`${row.amount} 조달`, docs);
  if (issues.some((i) => i.rule === "currency_mismatch")) return "currency";
  if (issues.some((i) => i.rule === "money_not_deal")) return "value";
  return null;
}

/** STORIES 한 줄의 지역 표시: 사건 기사들의 대표 지역 최빈값(region) + 중국 주체 여부(cn, 검증기와 같은 chinaByRegion). 판정이 없으면 표시 없음 */
export function storyRegion(docs: SourceDoc[] | undefined): { region?: string; cn?: true } {
  const judged = (docs ?? []).filter((d) => d.subject_region);
  if (!judged.length) return {};
  const counts = new Map<string, number>();
  for (const d of judged) counts.set(d.subject_region!, (counts.get(d.subject_region!) ?? 0) + 1);
  const region = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
  return { region, ...(chinaByRegion([judged]) ? { cn: true as const } : {}) };
}

/** 월간 합본 입력: 그달에 발행된 주간 리포트 요약 */
export interface WeeklyDigest {
  key: string;
  headline: string;
  flows: { title: string; text: string }[];
}

/** 월간 근거 후보를 주간판이 인용한 사건(+돈 흐름 표 기사)으로 좁힌다 (순수). S id 는 그대로(빈 번호 허용) */
export function filterPoolToWeeklies(pool: StoryPoolItem[], weeklyIds: Set<string>, moneyIds: Set<string>): StoryPoolItem[] {
  return pool.filter((p) => p.ids.some((id) => weeklyIds.has(id) || moneyIds.has(id)));
}

export function buildPeriodicUserPrompt(
  m: PeriodMetrics,
  facts: Record<string, string>,
  pool: StoryPoolItem[],
  docs?: Map<string, SourceDoc[]>,
  weeklies?: WeeklyDigest[]
): string {
  const W = WORDS[kindOfMetrics(m)];
  const sidOf = new Map(pool.flatMap((p) => p.ids.map((id) => [id, p.sid] as const)));
  // 기사 id → 근거 기사 (S id 의 docs 중 그 기사)
  const docOf = (id: string): SourceDoc[] => {
    const sid = sidOf.get(id);
    const p = sid ? pool.find((x) => x.sid === sid) : undefined;
    const list = sid ? docs?.get(sid) ?? [] : [];
    const i = p ? p.ids.indexOf(id) : -1;
    return i >= 0 && list[i] ? [list[i]] : [];
  };
  const moneyRows = m.money_table.map((r) => ({ r, problem: moneyRowProblem(r, docOf(r.id)) }));
  const kept = moneyRows.filter((x) => !x.problem).map((x) => x.r);
  const droppedValue = moneyRows.filter((x) => x.problem === "value").length;
  const droppedCur = moneyRows.filter((x) => x.problem === "currency").length;
  const moneyNote = droppedValue || droppedCur ? `\n(제외: 매출·기업가치 금액 ${droppedValue}행, 중국어 원문과 통화가 다른 금액 ${droppedCur}행 — 쓰지 마십시오)` : "";
  const span = m.kind === "monthly" ? `${m.period.start.slice(0, 7)} 한 달` : "월~일";
  const noPrev =
    m.kind === "monthly"
      ? ". 직전 달 비교 없음(비교 기간이 축소 수집이거나 없음) → 달 안의 주별 비교만 (평일 평균·1천 건당)"
      : `. ${W.prev} 비교 없음(비교 기간이 축소 수집)`;
  const period = `${m.period.start} ~ ${m.period.end} (${span}, 베이징 날짜)${m.baseline ? `. 비교 기준: ${W.prev} ${m.baseline.start} ~ ${m.baseline.end}` : noPrev}`;
  const weeks = (m.weeks ?? [])
    .map(
      (w) =>
        `${w.key} | ${w.start}~${w.end} | ${w.days}일 중 완전 ${w.complete_days}일 | ${w.coverage === "full" ? "완전" : w.coverage === "reduced" ? "축소 수집" : "부분 수집 포함"}`
    )
    .join("\n");
  // 월간: 주마다 그 주에 날짜가 있는 사건 (month_arc refs 는 여기서만)
  const weekStories = (m.weeks ?? [])
    .map((w) => `${w.key}: ${pool.filter((p) => p.days.some((d) => d >= w.start && d <= w.end)).map((p) => p.sid).join(", ") || "(없음)"}`)
    .join("\n");
  const weeklyBlock = weeklies?.length
    ? `\nWEEKLY_REPORTS (그달에 검토·발행된 주간 리포트 — 흐름의 길잡이, 근거는 STORIES·FACTS):\n${weeklies
        .map((w) => `${w.key} | ${w.headline}\n${w.flows.map((f) => `  - ${f.title}: ${f.text.slice(0, 160)}`).join("\n")}`)
        .join("\n")}`
    : "";
  return `PERIOD: ${period}
DATA_QUALITY: ${dataQualityLine(m)}${weeks ? `\nWEEKS:\n${weeks}` : ""}${weekStories ? `\nWEEK_STORIES (month_arc 의 주별 refs 후보):\n${weekStories}` : ""}${weeklyBlock}
FACTS (key = 값 문자열):
${Object.entries(facts)
  .map(([k, x]) => `${k} = ${x}`)
  .join("\n")}

MONEY (제목에 나온 거래 금액, 합산·크기 비교 금지):
${kept
  .map((r) => `${sidOf.get(r.id) ?? "?"} | ${r.day} | ${r.kind} | ${r.amount}${r.same_deal?.length ? ` (= ${r.same_deal.map((x) => x.amount).join(", ")}, 같은 거래)` : ""} | ${r.title_kr}`)
  .join("\n")}${moneyNote}

STORIES (${pool.length}건, sources = 함께 다룬 매체):
${pool
  .map((p) =>
    JSON.stringify({ id: p.sid, sources: p.sources, days: p.days, ent: p.entities, ...storyRegion(docs?.get(p.sid)), title_kr: p.title_kr, summary_kr: (p.summary_kr || "").slice(0, 200) })
  )
  .join("\n")}`;
}

/** 주간 사용자 프롬프트 (예전 이름) */
export const buildWeeklyUserPrompt = buildPeriodicUserPrompt;

export function buildWeeklyRepairPrompt(draft: WeeklyContent, problems: ValidationIssue[], extra: string[], kind: PeriodicKind = "weekly"): string {
  const lines = [...problems.map((f) => `- [${f.rule}] ${f.path}: ${f.detail}`), ...extra.map((e) => `- ${e}`)].join("\n");
  const volume = kind === "monthly" ? "주별 물량 비교는 week.W..weekday_avg 로만, 기업 주별 변화는 .per1k 로만 합니다" : "물량 비교는 vol.lfl_change 로만 합니다";
  return `아래 JSON 은 당신이 방금 쓴 ${WORDS[kind].name} 리포트입니다. 자동 검증에서 다음 문제가 나왔습니다.

${lines}

문제가 된 항목만 고쳐서 같은 스키마의 JSON 전체를 다시 출력하십시오.
- 근거에 없는 숫자·기업명·서열 표현은 FACTS 값이나 refs 기사에 나온 표현으로 바꾸거나 문장에서 뺍니다.
- 증감을 말하는 문장에는 그 증감 FACTS 키를 metrics 에 넣습니다. 지표 방향과 반대되는 문장("줄었는데 열풍")은 지우십시오. 다시 쓸 때는 FACTS 값 문자열을 그대로 인용합니다(예: "智能体 84건→55건"). 기사에 나온 사실(호출량·매출 등)의 방향은 바꾸지 마십시오.
- ${volume}. 통화가 다른 금액끼리 크기를 비교하지 않습니다.
- metrics 에 넣은 지표의 대상이 문장에 없으면 그 지표를 빼거나 문장에 대상을 씁니다.
- headline 이 ${WEEKLY_HEADLINE_MAX}자를 넘었다면 뜻을 유지한 채 ${WEEKLY_HEADLINE_MAX}자 이내로 다시 씁니다.
- 한국어 문장의 한자는 한국어 표기로 바꿉니다 (term.term 만 예외).
- money 에서는 금액 서열·크기 비교를 빼고, 매출·기업가치 금액을 거래처럼 쓴 문장을 지웁니다.
- 순위 표현("가장 많이 …")은 FACTS 1위가 아니면 지우고, 최상급·추세 단정은 기사 표현(한정 포함) 그대로 씁니다.
- 고친 결과만 본문에 씁니다. 지시문·괄호 메모("~ 대신 ~", "수정:")를 본문에 남기지 마십시오.
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
  if (lfl && lfl.days > 0) {
    parts.push(`같은 요일끼리 비교한 기사 수는 ${WORDS[kindOfMetrics(m)].prev} 대비 ${lfl.display_change}였다.`);
    metrics.push("vol.lfl_change");
  }
  if (top.length) {
    parts.push(`가장 많이 다뤄진 기업은 ${top.map((e) => `${e.name_ko} ${e.display}`).join(", ")}이었다.`);
    metrics.push(...top.map((e) => `ent.${e.key}`));
  }
  const reduced = m.data_quality.reduced_days?.length ?? 0;
  if (reduced) {
    parts.push(`축소 수집일 ${reduced}일이 섞여 있어 기사 수로 흐름을 비교하지 않았다.`);
    metrics.push("dq.reduced_days");
  }
  return { text: parts.join(" "), metrics };
}

/** headline 대체 */
export function fallbackHeadline(m: PeriodMetrics): string {
  const top = m.entities[0];
  const cur = m.kind === "monthly" ? `${Number(m.period.start.slice(5, 7))}월` : "이번 주";
  return top ? `${cur} 중국 AI 보도, ${top.name_ko} 언급 최다` : `${cur} 중국 AI 흐름`;
}
