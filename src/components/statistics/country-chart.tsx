"use client";

import { useTranslations } from "next-intl";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { CountryStat } from "@/lib/statistics-utils";

interface CountryChartProps {
  data: CountryStat[];
}

export function CountryChart({ data }: CountryChartProps) {
  const t = useTranslations("statistics");

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{t("countryBreakdown")}</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={data} layout="vertical" margin={{ left: 20 }}>
            <XAxis type="number" allowDecimals={false} />
            <YAxis type="category" dataKey="label" width={90} tick={{ fontSize: 13 }} />
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
