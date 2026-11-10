/**
 * 브리핑 화면·아침 메일에 금액 환산 표기를 붙인다 (2026-11-06 사용자 결정, fx/convert.ts).
 * 브리핑 페이지(briefing-page.tsx)와 아침 메일(newsletter/send.ts)이 이 함수 하나를 부른다 (Gate 2).
 * 카드 그림 화면·음성 원고·숫자 검사는 부르지 않는다 — 저장된 판과 같은 원래 금액만 본다.
 *
 * 붙이는 곳: 리드, 주요 기사 무엇·왜, 분야별 항목, 주목할 기업, 히스토리 분석(배경·흐름·지금).
 * 붙이지 않는 곳: 헤드라인·제목(짧아야 한다), 쉬운 AI 설명(숫자 없음), 큰 숫자 칸(값 아래 작은 줄로 따로 — briefing-view).
 * 환율 = 판 날짜(그날 이하 가장 최근 영업일)의 ECB 기준.
 */
import type { PublicBriefing } from "../briefing/public";
import type { PublicPeriodic } from "../briefing/periodic/public";
import { annotateMoney, convertAmountText, type FxLocale } from "./convert";
import { loadFxRates } from "./store";

export async function withFxNotes(b: PublicBriefing): Promise<PublicBriefing> {
  const rates = await loadFxRates(b.edition_date);
  if (!rates) return { ...b, fx: null };
  const loc = b.locale as FxLocale;
  const a = (s: string | undefined | null) => (s ? annotateMoney(s, loc, rates) : (s ?? ""));
  const c = structuredClone(b.content);
  c.lede = a(c.lede);
  c.top_stories = c.top_stories.map((s) => ({
    ...s,
    what: a(s.what),
    why: a(s.why),
    story_context: s.story_context?.map((x) => ({
      ...x,
      background: a(x.background),
      timeline: x.timeline.map((t) => ({ ...t, text: a(t.text) })),
      now: a(x.now),
    })),
  }));
  c.sections = c.sections.map((sec) => ({ ...sec, items: sec.items.map((it) => ({ ...it, text: a(it.text) })) }));
  c.companies_to_watch = c.companies_to_watch.map((co) => ({ ...co, why: a(co.why) }));
  // 바뀐 곳이 있거나 큰 숫자 칸에 환산할 금액이 있을 때만 각주를 단다
  const applied = JSON.stringify(c) !== JSON.stringify(b.content) || c.key_numbers.some((k) => convertAmountText(k.value, loc, rates));
  return { ...b, content: c, fx: rates, fxApplied: applied };
}

/**
 * 주간·월간 리포트에도 같은 환산 (2026-11-10 사용자 결정: 주간·월간도 데일리 개선 반영). 공개 페이지·관리자 미리보기가 이 함수를 부른다.
 * 붙이는 곳: dek, 큰 흐름 사실 문장, 움직인 기업, 돈의 흐름, 중국 렌즈, 다음 주 볼 것. 쉽게 풀어보기(숫자 없음)·제목은 붙이지 않는다.
 * 환율 = 기간 마지막 날(그날 이하 가장 최근 영업일)의 ECB 기준.
 */
export async function withPeriodicFx(w: PublicPeriodic): Promise<PublicPeriodic> {
  const rates = await loadFxRates(w.period_end);
  if (!rates) return { ...w, fx: null };
  const loc = w.locale as FxLocale;
  const a = (s: string) => (s ? annotateMoney(s, loc, rates) : s);
  const c = structuredClone(w.content);
  c.dek = a(c.dek);
  c.big_picture = c.big_picture.map((b) => ({ ...b, text: a(b.text) }));
  c.movers = c.movers.map((m) => ({ ...m, text: a(m.text) }));
  if (c.money) c.money = { ...c.money, text: a(c.money.text) };
  if (c.china_lens) c.china_lens = { ...c.china_lens, text: a(c.china_lens.text) };
  c.watch_next = c.watch_next.map((x) => ({ ...x, text: a(x.text) }));
  c.month_arc = (c.month_arc ?? []).map((x) => ({ ...x, text: a(x.text) }));
  const applied = JSON.stringify(c) !== JSON.stringify(w.content);
  return { ...w, content: c, fx: rates, fxApplied: applied };
}
