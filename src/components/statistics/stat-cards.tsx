"use client";

import { useTranslations } from "next-intl";
import { Newspaper, CalendarCheck, Tags, Rss, TrendingUp, BrainCircuit } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { KPIData } from "@/lib/statistics-utils";

interface StatCardsProps {
  data: KPIData;
}

export function StatCards({ data }: StatCardsProps) {
  const t = useTranslations("statistics");

  const cards = [
    {
      label: t("totalNews"),
      value: data.totalNews,
      icon: Newspaper,
      color: "text-blue-600",
    },
    {
      label: t("todayNews"),
      value: data.todayNews,
      icon: CalendarCheck,
      color: "text-green-600",
    },
    {
      label: t("categories"),
      value: data.categoryCount,
      icon: Tags,
      color: "text-purple-600",
    },
    {
      label: t("sources"),
      value: data.sourceCount,
      icon: Rss,
      color: "text-amber-600",
    },
    {
      label: t("avgPerDay"),
      value: data.avgPerDay,
      icon: TrendingUp,
      color: "text-cyan-600",
    },
    {
      label: t("aiRatio"),
      value: `${data.aiRatio}%`,
      icon: BrainCircuit,
      color: "text-violet-600",
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
      {cards.map((card) => (
        <Card key={card.label}>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{card.label}</p>
                <p className="text-3xl font-bold mt-1">{card.value}</p>
              </div>
              <card.icon className={`w-8 h-8 ${card.color} opacity-80`} />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
