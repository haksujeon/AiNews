"use client";

import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { KeywordStat } from "@/lib/statistics-utils";

interface KeywordChartProps {
  data: KeywordStat[];
}

export function KeywordChart({ data }: KeywordChartProps) {
  const t = useTranslations("statistics");

  if (data.length === 0) return null;

  const maxCount = data[0]?.count || 1;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{t("topKeywords")}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {data.map((item) => {
            const widthPct = Math.max(8, (item.count / maxCount) * 100);
            return (
              <div key={item.term} className="flex items-center gap-3">
                <Badge variant="secondary" className="text-xs shrink-0 min-w-[60px] justify-center">
                  {item.term}
                </Badge>
                <div className="flex-1 flex items-center gap-2">
                  <div className="flex-1 bg-muted rounded-full h-5 overflow-hidden">
                    <div
                      className="h-full bg-violet-500/70 rounded-full flex items-center justify-end pr-2"
                      style={{ width: `${widthPct}%` }}
                    >
                      <span className="text-[10px] font-medium text-white">{item.count}</span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
