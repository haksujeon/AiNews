"use client";

import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatBars } from "@/components/charts/stat-charts";
import type { WeeklyTrend } from "@/lib/statistics-utils";

interface WeeklyTrendChartProps {
  data: WeeklyTrend[];
}

export function WeeklyTrendChart({ data }: WeeklyTrendChartProps) {
  const t = useTranslations("statistics");
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{t("weeklyTrend")}</CardTitle>
      </CardHeader>
      <CardContent>
        <StatBars
          label={t("weeklyTrend")}
          rows={data.map((d) => ({ name: d.week.slice(5), value: d.count }))} // MM-DD (주 시작일)
          unit={(n) => `${t("weeklyTotal")} ${n} ${t("articles")}`}
        />
      </CardContent>
    </Card>
  );
}
