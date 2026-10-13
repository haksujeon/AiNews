"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Loader2, Minus, Plus } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { NewsItem } from "@/lib/supabase";
import { fetchNewsDetailClient, fetchRelatedNewsClient } from "@/lib/supabase-client";
import { getTitle, getImageUrl } from "@/lib/news-utils";
import { Link } from "@/i18n/navigation";
import { NewsThumbnail } from "./news-thumbnail";
import { ArticleKicker } from "./article-kicker";
import { ArticleBody, ArticleByline, KeyTerms } from "./article-body";

interface NewsDetailModalProps {
  news: NewsItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// 가로채기 라우트(@modal/(.)news/[id])에서만 쓰인다. 카드/리스트/관련기사 클릭은 모두
// /news/[id] 링크 이동이며, 직접 접속 시에는 같은 데이터로 전체 페이지(NewsDetail)가 렌더된다.
// 본문 렌더링은 전체 페이지와 같은 컴포넌트(ArticleByline/ArticleBody/KeyTerms)를 쓴다.
export function NewsDetailModal({ news, open, onOpenChange }: NewsDetailModalProps) {
  const locale = useLocale();
  const t = useTranslations("detail");
  const [detail, setDetail] = useState<NewsItem | null>(null);
  const [relatedNews, setRelatedNews] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [relatedCount, setRelatedCount] = useState(2);

  useEffect(() => {
    // 관련 기사로 연속 이동할 때 늦게 도착한 이전 기사 응답이 덮어쓰지 않도록 한다.
    let cancelled = false;
    if (open && news) {
      setLoading(true);
      setError(false);
      Promise.all([
        fetchNewsDetailClient(news.id),
        fetchRelatedNewsClient(news.category, news.id, 4),
      ])
        .then(([detailData, related]) => {
          if (cancelled) return;
          setDetail(detailData);
          setRelatedNews(related);
        })
        .catch(() => {
          if (!cancelled) setError(true);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }
    if (!open) {
      setDetail(null);
      setRelatedNews([]);
      setError(false);
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, news?.id]);

  if (!news) return null;

  const fullItem = detail ?? news;
  const title = getTitle(fullItem, locale);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* grid(기본값) 대신 flex-col: grid 에서는 aspect-ratio 이미지 행이 0px 로 접혀 본문과 겹친다 */}
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-y-auto rounded-md border-rule bg-background p-0 shadow-xl sm:max-h-[88vh] sm:max-w-[760px]">
        <NewsThumbnail
          src={getImageUrl(fullItem)}
          alt={title}
          className="aspect-[2/1] w-full shrink-0"
          sizes="(max-width: 800px) 100vw, 760px"
        />

        <div className="space-y-6 p-5 sm:p-8">
          <DialogHeader className="gap-3 text-left sm:text-left">
            <ArticleKicker category={fullItem.category} sourceName={fullItem.source_name} locale={locale} className="pr-8" />
            <DialogTitle className="pr-8 text-2xl font-bold leading-[1.3] tracking-[-0.02em] text-ink sm:text-[30px]">
              {title}
            </DialogTitle>
            <DialogDescription asChild>
              <div>
                <ArticleByline news={fullItem} locale={locale} />
              </div>
            </DialogDescription>
          </DialogHeader>

          {loading ? (
            <div className="flex items-center justify-center gap-2 py-8 text-ink-3">
              <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
              <span className="text-sm">{t("loading")}</span>
            </div>
          ) : error ? (
            <div role="alert" className="flex flex-col items-center justify-center gap-1 py-8 text-center">
              <span className="text-sm text-ink-2">{t("loadError")}</span>
              <span className="text-xs text-ink-3">{t("loadErrorHint")}</span>
            </div>
          ) : (
            <>
              <ArticleBody news={fullItem} locale={locale} headingTag="h3" />
              <KeyTerms terms={fullItem.key_terms} locale={locale} headingTag="h3" />
            </>
          )}

          {/* Related news */}
          {relatedNews.length > 0 && (
            <section>
              <div className="mb-1 flex items-center justify-between border-b border-rule-strong pb-2">
                <h3 className="text-sm font-bold text-ink">{t("relatedNews")}</h3>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    disabled={relatedCount <= 1}
                    onClick={() => setRelatedCount((c) => Math.max(1, c - 1))}
                    aria-label={t("fewerRelated")}
                  >
                    <Minus className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                  <span className="w-5 text-center text-sm text-ink-2" aria-live="polite">{relatedCount}</span>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    disabled={relatedCount >= Math.min(4, relatedNews.length)}
                    onClick={() => setRelatedCount((c) => Math.min(4, relatedNews.length, c + 1))}
                    aria-label={t("moreRelated")}
                  >
                    <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
                {relatedNews.slice(0, relatedCount).map((item) => (
                  // 관련 기사도 카드와 같은 링크 경로. replace 로 이동해 모달을 닫으면(back)
                  // 이전 기사가 아니라 목록으로 돌아가게 한다.
                  <Link
                    key={item.id}
                    href={`/news/${item.id}`}
                    replace
                    scroll={false}
                    prefetch={false}
                    className="group block space-y-1.5 rounded-sm border-b border-rule py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <ArticleKicker category={item.category} sourceName={item.source_name} locale={locale} />
                    <p className="text-[15px] font-semibold leading-snug text-ink line-clamp-2 decoration-1 underline-offset-[3px] group-hover:underline">
                      {getTitle(item, locale)}
                    </p>
                  </Link>
                ))}
              </div>
            </section>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
