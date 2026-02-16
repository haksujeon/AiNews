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

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{t("categoryDistribution")}</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={280}>
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={60}
              outerRadius={100}
              dataKey="value"
              nameKey="name"
              paddingAngle={2}
            >
              {data.map((entry) => (
                <Cell key={entry.name} fill={entry.color} />
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
