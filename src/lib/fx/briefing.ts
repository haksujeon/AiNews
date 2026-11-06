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
