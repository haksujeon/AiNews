import { fetchNewsStatistics } from "@/lib/supabase";
import { AdminShell } from "@/components/admin/admin-shell";
import { StatisticsContainer } from "@/components/statistics/statistics-container";

/**
 * 통계 (관리자) — 2026-11-03 메뉴 개편: 공개 메뉴의 "통계"를 관리자 메뉴로 옮겼다(공개 /statistics 는 /news 로 308).
 * 공개 자리에는 기사 기반 기업·이슈 콘텐츠를 따로 만든다 (~/ainews-reports/home-ui-2026-11/REVIEW.md).
 * 접근 제어는 미들웨어(ADMIN_PATTERN)가 한다. 집계는 예전과 같은 fetchNewsStatistics (Gate 2).
 */
export const dynamic = "force-dynamic";

export default async function AdminStatisticsPage() {
  const stats = await fetchNewsStatistics();
  return (
    <AdminShell>
      <StatisticsContainer stats={stats} />
    </AdminShell>
  );
}
