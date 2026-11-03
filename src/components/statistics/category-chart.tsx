"use client";

import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatDonut } from "@/components/charts/stat-charts";
import type { CategoryStat } from "@/lib/statistics-utils";

interface CategoryChartProps {
  data: CategoryStat[];
}

export function CategoryChart({ data }: CategoryChartProps) {
  const t = useTranslations("statistics");
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{t("categoryDistribution")}</CardTitle>
      </CardHeader>
      <CardContent>
        <StatDonut
          label={t("categoryDistribution")}
          rows={data.map((d) => ({ name: d.label, value: d.value, color: d.color }))}
          unit={(n) => `${n} ${t("articles")}`}
        />
      </CardContent>
    </Card>
  );
}
