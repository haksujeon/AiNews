"use client";

import { useTranslations } from "next-intl";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { WeeklyTrend } from "@/lib/statistics-utils";

interface WeeklyTrendChartProps {
  data: WeeklyTrend[];
}

export function WeeklyTrendChart({ data }: WeeklyTrendChartProps) {
  const t = useTranslations("statistics");

  const formatted = data.map((d) => ({
    ...d,
    week: d.week.slice(5), // MM-DD
  }));

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{t("weeklyTrend")}</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={formatted} margin={{ left: -10 }}>
            <XAxis dataKey="week" tick={{ fontSize: 11 }} />
            <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
            <Tooltip
              formatter={(value) => [`${value} ${t("articles")}`, t("weeklyTotal")]}
            />
            <Bar dataKey="count" fill="#3b82f6" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
