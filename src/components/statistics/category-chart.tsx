"use client";

import { useTranslations } from "next-intl";
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { CategoryStat } from "@/lib/statistics-utils";

interface CategoryChartProps {
  data: CategoryStat[];
}

export function CategoryChart({ data }: CategoryChartProps) {
  const t = useTranslations("statistics");

  const chartData = data.map((d) => ({ ...d, name: d.label }));

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{t("categoryDistribution")}</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={280}>
          <PieChart>
            <Pie
              data={chartData}
              cx="50%"
              cy="50%"
              innerRadius={60}
              outerRadius={100}
              dataKey="value"
              nameKey="name"
              paddingAngle={2}
            >
              {chartData.map((entry, i) => (
                <Cell key={i} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip
              formatter={(value) => [`${value} ${t("articles")}`, ""]}
            />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
