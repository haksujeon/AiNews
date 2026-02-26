"use client";

import { useTranslations } from "next-intl";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={data} layout="vertical" margin={{ left: 20 }}>
            <XAxis type="number" allowDecimals={false} />
            <YAxis
              type="category"
              dataKey="name"
              width={100}
              tick={{ fontSize: 11 }}
            />
            <Tooltip
              formatter={(value) => [`${value} ${t("articles")}`, ""]}
            />
            <Bar dataKey="value" fill="#3b82f6" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
