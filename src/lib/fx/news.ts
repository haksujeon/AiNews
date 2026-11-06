/**
 * 기사 상세에 금액 환산 표기를 붙인다 (fx/convert.ts). 상세 페이지·가로채기 팝업·공개 상세 API 가 이 함수 하나를 부른다 (Gate 2).
 * 붙이는 곳: 그 언어의 요약·AI 인사이트(쉬운·자세히)·번역 요지. 제목은 짧아야 해서 붙이지 않는다.
 * 환율 = 기사 날짜(news_date, 그날 이하 가장 최근 영업일)의 ECB 기준. 저장된 기사는 바꾸지 않는다.
 */
import type { PublicNewsItem } from "../news-gist";
import { annotateMoney, type FxLocale, type FxRates } from "./convert";
import { loadFxRates } from "./store";

const SUFFIX: Record<FxLocale, "kr" | "en" | "cn"> = { ko: "kr", en: "en", zh: "cn" };

export type FxNewsItem = PublicNewsItem & { fx?: FxRates | null };

export async function withNewsFx<T extends PublicNewsItem>(item: T, locale: string): Promise<T & { fx?: FxRates | null }> {
  const loc = (["ko", "en", "zh"].includes(locale) ? locale : "ko") as FxLocale;
  const date = (item.news_date ?? item.created_at ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return item;
  const rates = await loadFxRates(date);
  if (!rates) return item;
  const sfx = SUFFIX[loc];
  const out: Record<string, unknown> = { ...item };
  let changed = false;
  for (const k of [`summary_${sfx}`, `ai_insights_${sfx}`, `ai_insights_detail_${sfx}`, "gist"]) {
    const v = out[k];
    if (typeof v !== "string" || !v) continue;
    const a = annotateMoney(v, loc, rates);
    if (a !== v) {
      out[k] = a;
      changed = true;
    }
  }
  return { ...(out as T), fx: changed ? rates : null };
}
