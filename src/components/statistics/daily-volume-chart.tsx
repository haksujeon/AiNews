"use client";

import { useTranslations } from "next-intl";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { DailyVolume } from "@/lib/statistics-utils";

interface DailyVolumeChartProps {
  data: DailyVolume[];
}

export function DailyVolumeChart({ data }: DailyVolumeChartProps) {
  const t = useTranslations("statistics");

  const formatted = data.map((d) => ({
    ...d,
    date: d.date.slice(5), // "MM-DD" format
  }));

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{t("dailyVolume")}</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={280}>
          <AreaChart data={formatted} margin={{ left: -10 }}>
            <defs>
              <linearGradient id="volumeGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="date" tick={{ fontSize: 12 }} />
            <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
            <Tooltip
              formatter={(value) => [`${value} ${t("articles")}`, ""]}
            />
            <Area
              type="monotone"
              dataKey="count"
              stroke="#3b82f6"
              fill="url(#volumeGradient)"
              strokeWidth={2}
            />
          </AreaChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
