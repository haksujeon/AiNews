import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { isLocale } from "@/i18n/routing";

/**
 * 404 화면의 메타데이터 — 모든 404(모르는 경로·기사·기업·브리핑·주간/월간)가 이것만 쓴다 (Gate 2, QA C-02).
 * 제목은 "페이지를 찾을 수 없습니다 | SDSC AI NEWS"(레이아웃 template), 색인하지 않는다.
 */
export async function notFoundMetadata(locale: string): Promise<Metadata> {
  const t = await getTranslations({ locale: isLocale(locale) ? locale : "ko", namespace: "notFound" });
  return { title: t("title"), robots: { index: false } };
}
