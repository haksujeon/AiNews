"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  ChevronRight,
  Mail,
  FileText,
  Users,
  Loader2,
  RotateCw,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { apiUrl } from "@/lib/api-path";
import { extractErrorMessage } from "@/lib/api-error";
import { getCategoryLabel } from "@/lib/news-utils";
import { useRouter } from "@/i18n/navigation";

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
  const t = useTranslations("admin");
  const tc = useTranslations("common");
  const router = useRouter();
  const [events, setEvents] = useState<SendEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [reloadToken, setReloadToken] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(apiUrl("/api/admin/send-history"));
        if (cancelled) return;
        if (res.status === 401) {
          // 세션 만료 → 로그인으로
          router.replace("/admin/login");
          return;
        }
        if (!res.ok) {
          const fallback =
            res.status >= 500 ? t("serverError", { status: res.status }) : t("loadFailed");
          const msg = await extractErrorMessage(res, fallback);
          if (!cancelled) setLoadError(msg);
          return;
        }
        const d = await res.json();
        if (!cancelled) {
          setEvents(d.data?.events || []);
          setLoadError("");
        }
      } catch {
        if (!cancelled) setLoadError(t("networkError"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadToken, router, t]);

  const totalSends = events.length;
  const totalArticles = events.reduce((s, e) => s + e.articleCount, 0);
  const totalRecipients = events.reduce((s, e) => s + e.recipientCount, 0);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        {tc("loading")}
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">{t("sendHistory")}</h1>
        <Card className="border-destructive/40">
          <CardContent role="alert" className="p-8 text-center space-y-4">
            <p className="text-sm text-destructive">{loadError}</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setLoading(true);
                setReloadToken((n) => n + 1);
              }}
            >
              <RotateCw className="w-3.5 h-3.5 mr-1.5" aria-hidden="true" />
              {tc("retry")}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{t("sendHistory")}</h1>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          { icon: Mail, label: t("totalSends"), value: totalSends },
          { icon: FileText, label: t("articlesSent"), value: totalArticles },
          { icon: Users, label: t("totalRecipients"), value: totalRecipients },
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
            {t("noSends")}
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
                            {getCategoryLabel(article.category, locale)}
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
