"use client";

import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatDonut } from "@/components/charts/stat-charts";
import type { SentimentStat } from "@/lib/statistics-utils";

interface SentimentChartProps {
  data: SentimentStat[];
}

export function SentimentChart({ data }: SentimentChartProps) {
  const t = useTranslations("statistics");
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{t("sentimentAnalysis")}</CardTitle>
      </CardHeader>
      <CardContent>
        <StatDonut
          label={t("sentimentAnalysis")}
          rows={data.map((d) => ({ name: d.label, value: d.value, color: d.color }))}
          unit={(n) => `${n} ${t("articles")}`}
        />
      </CardContent>
    </Card>
  );
}
