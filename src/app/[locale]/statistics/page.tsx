import { permanentRedirect } from "next/navigation";

/**
 * 예전 공개 통계 주소 — 2026-11-03 메뉴 개편으로 통계는 관리자 메뉴(/admin/statistics)로 옮겼다.
 * 공개 링크·검색 노출은 관리자 로그인 대신 뉴스 목록으로 보낸다 (308).
 */
export default async function StatisticsMoved({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  permanentRedirect(`/${locale}/news`);
}
