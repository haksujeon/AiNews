"use client";

import { useTranslations } from "next-intl";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { RegionCounts } from "@/lib/metrics/period";

interface RegionChartProps {
  /** regionCounts (홈 지역 칩·주간/월간 리포트와 같은 함수) */
  data: RegionCounts;
}

/** 대상 지역 비중: 칩과 같은 세 묶음(중국 · 미국 · 그 밖). 비중의 분모는 지역 판정이 있는 기사 */
export function RegionChart({ data }: RegionChartProps) {
  const t = useTranslations("statistics");
  const rows = [
    { name: t("regionCN"), value: data.buckets.CN, pct: data.cn_pct },
    { name: t("regionUS"), value: data.buckets.US, pct: data.us_pct },
    { name: t("regionOTHER"), value: data.buckets.OTHER, pct: data.other_pct },
  ].map((r) => ({ ...r, name: `${r.name} ${r.pct}%` }));

  return (
    <Card data-testid="region-chart">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{t("regionDistribution")}</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={rows} layout="vertical" margin={{ left: 8, right: 16 }}>
            <XAxis type="number" allowDecimals={false} />
            <YAxis type="category" dataKey="name" width={96} tick={{ fontSize: 12 }} />
            <Tooltip formatter={(value) => [`${value} ${t("articles")}`, ""]} />
            <Bar dataKey="value" fill="#3b82f6" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          {t("regionNote", { classified: data.classified, uschina: data.us_china, korea: data.korea, unclassified: data.unclassified })}
        </p>
      </CardContent>
    </Card>
  );
}
