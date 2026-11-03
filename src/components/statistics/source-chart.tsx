"use client";

import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatBars } from "@/components/charts/stat-charts";
import type { SourceStat } from "@/lib/statistics-utils";

interface SourceChartProps {
  data: SourceStat[];
}

export function SourceChart({ data }: SourceChartProps) {
  const t = useTranslations("statistics");
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{t("sourceDistribution")}</CardTitle>
      </CardHeader>
      <CardContent>
        <StatBars horizontal label={t("sourceDistribution")} rows={data.map((d) => ({ name: d.name, value: d.value }))} unit={(n) => `${n} ${t("articles")}`} />
      </CardContent>
    </Card>
  );
}
