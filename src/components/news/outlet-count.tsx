"use client";

import { useTranslations } from "next-intl";

/**
 * "N개 매체 보도" — 같은 글(전재)을 실은 매체가 둘 이상일 때만. 카드·리스트 항목이 같은 부품을 쓴다.
 * 매체 수는 공용 순위 함수(src/lib/news-rank.ts)의 전재 묶음에서 온다.
 */
export function OutletCount({ count }: { count?: number }) {
  const t = useTranslations("list");
  if (!count || count < 2) return null;
  return (
    <span className="text-xs font-medium text-ink-2" data-testid="outlet-count">
      {t("outlets", { count })}
    </span>
  );
}
