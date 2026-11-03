"use client";

import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatArea } from "@/components/charts/stat-charts";
import type { DailyVolume } from "@/lib/statistics-utils";

interface DailyVolumeChartProps {
  data: DailyVolume[];
}

export function DailyVolumeChart({ data }: DailyVolumeChartProps) {
  const t = useTranslations("statistics");
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{t("dailyVolume")}</CardTitle>
      </CardHeader>
      <CardContent>
        <StatArea
          label={t("dailyVolume")}
          points={data.map((d) => ({ name: d.date.slice(5), value: d.count }))} // "MM-DD"
          unit={(n) => `${n} ${t("articles")}`}
        />
      </CardContent>
    </Card>
  );
}
