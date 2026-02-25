"use client";

import { useEffect, useState } from "react";
import { useLocale } from "next-intl";
import {
  ChevronRight,
  Mail,
  FileText,
  Users,
  Loader2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

interface Article {
  id: string;
  title_kr: string | null;
  title_en: string | null;
  title_cn: string | null;
  category: string | null;
  news_date: string | null;
  send_count: number | null;
  source_name: string | null;
}

interface SendEvent {
  bucketTime: string;
  articleCount: number;
  recipientCount: number;
  articles: Article[];
}

export function SendHistoryContainer() {
  const locale = useLocale();
  const [events, setEvents] = useState<SendEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/send-history")
      .then((r) => r.json())
      .then((d) => setEvents(d.data?.events || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const totalSends = events.length;
  const totalArticles = events.reduce((s, e) => s + e.articleCount, 0);
  const totalRecipients = events.reduce((s, e) => s + e.recipientCount, 0);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        Loading...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Send History</h1>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          { icon: Mail, label: "Total Sends", value: totalSends },
          { icon: FileText, label: "Articles Sent", value: totalArticles },
          { icon: Users, label: "Total Recipients", value: totalRecipients },
        ].map((stat) => (
          <Card key={stat.label} className="border-border/50 bg-card/50">
            <CardContent className="flex items-center gap-3 p-4">
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                <stat.icon className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{stat.label}</p>
                <p className="text-xl font-bold">{stat.value}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Events list */}
      {events.length === 0 ? (
        <Card className="border-border/50">
          <CardContent className="p-8 text-center text-muted-foreground">
            No newsletter sends found.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {events.map((event) => {
            const isExpanded = expandedId === event.bucketTime;
            const date = new Date(event.bucketTime);
            const dateStr = date.toLocaleDateString(locale === "ko" ? "ko-KR" : locale === "zh" ? "zh-CN" : "en-US", {
              year: "numeric",
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            });

            return (
              <Card
                key={event.bucketTime}
                className="border-border/50 bg-card/50 overflow-hidden"
              >
                <button
                  onClick={() =>
                    setExpandedId(isExpanded ? null : event.bucketTime)
                  }
                  className="w-full flex items-center gap-4 p-4 text-left hover:bg-accent/30 transition-colors"
                >
                  <ChevronRight
                    className={`w-4 h-4 text-muted-foreground transition-transform ${
                      isExpanded ? "rotate-90" : ""
                    }`}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{dateStr}</p>
                  </div>
                  <div className="flex items-center gap-4 text-sm text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <FileText className="w-3.5 h-3.5" />
                      {event.articleCount}
                    </span>
                    <span className="flex items-center gap-1">
                      <Users className="w-3.5 h-3.5" />
                      {event.recipientCount}
                    </span>
                  </div>
                </button>
                {isExpanded && (
                  <div className="border-t border-border/30 p-4 space-y-2 bg-muted/20">
                    {event.articles.map((article) => (
                      <div
                        key={article.id}
                        className="flex items-center gap-3 text-sm py-1.5"
                      >
                        <span className="flex-1 min-w-0 truncate">
                          {locale === "zh"
                            ? article.title_cn || article.title_kr || article.title_en
                            : locale === "en"
                            ? article.title_en || article.title_kr || article.title_cn
                            : article.title_kr || article.title_en || article.title_cn}
                        </span>
                        {article.category && (
                          <Badge
                            variant="secondary"
                            className="text-[10px] shrink-0"
                          >
                            {article.category}
                          </Badge>
                        )}
                        {article.source_name && (
                          <span className="text-xs text-muted-foreground shrink-0">
                            {article.source_name}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
