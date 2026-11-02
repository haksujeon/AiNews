import type { ComponentProps } from "react";
import { useLocale } from "next-intl";
import { getPathname } from "@/i18n/navigation";
import { BASE_PATH } from "@/lib/api-path";
import { briefingDatePath } from "@/lib/briefing/view";

type Props = Omit<ComponentProps<"a">, "href"> & {
  /** 데일리 판 날짜 → /briefing/YYYY-MM-DD */
  date?: string;
  /** 날짜 판이 아닌 브리핑 경로 (예: /briefing/archive). date 와 둘 중 하나 */
  path?: string;
  /** 다른 언어판으로 갈 때 */
  locale?: string;
};

/**
 * 브리핑 판끼리 잇는 링크 — 언제나 전체 페이지 이동(일반 <a>).
 * 이전·다음 판, 아카이브, 정정 기록의 대체판, 주간·월간 화면의 데일리 링크, 언어판 안내가 이 부품 하나를 쓴다 (Gate 2).
 *
 * 왜 전체 이동인가: @modal 가로채기 라우트는 /[locale] 아래 모든 화면의 소프트 이동을 가로챈다
 * (기사 전체 페이지에서 관련 기사를 눌러도 팝업이 뜬다). 브리핑 판 사이 이동은 팝업이 아니라 언제나 전체 페이지여야 하므로
 * 클라이언트 라우터를 거치지 않는다. 홈 날짜 팝업은 가로채기 대신 ?briefing= 대화상자로 구현했다(day-briefing-dialog.tsx).
 */
export function BriefingDateLink({ date, path, locale, ...rest }: Props) {
  const current = useLocale();
  const target = path ?? briefingDatePath(date ?? "");
  const href = `${BASE_PATH}${getPathname({ href: target, locale: locale ?? current })}`;
  return <a {...rest} href={href} />;
}
