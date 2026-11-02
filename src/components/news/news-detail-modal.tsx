"use client";

import { useEffect, useState } from "react";
import { useLocale } from "next-intl";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import type { PublicNewsItem } from "@/lib/news-gist";
import { EMPTY_RELATED, type RelatedSections } from "@/lib/related-types";
import { fetchRelatedNewsClient } from "@/lib/supabase-client";
import { getTitle, getImageUrl } from "@/lib/news-utils";
import { NewsThumbnail } from "./news-thumbnail";
import { ArticleKicker } from "./article-kicker";
import { ArticleBody, ArticleByline, KeyTerms } from "./article-body";
import { RelatedSectionsView } from "./related-sections";

interface NewsDetailModalProps {
  /** 가로채기 라우트가 서버에서 toPublicNewsItem() 으로 만든 기사(요지 포함, 번역 전문 없음) */
  news: PublicNewsItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// 가로채기 라우트(@modal/(.)news/[id])에서만 쓰인다. 카드/리스트/관련기사 클릭은 모두
// /news/[id] 링크 이동이며, 직접 접속 시에는 같은 데이터로 전체 페이지(NewsDetail)가 렌더된다.
// 본문 렌더링은 전체 페이지와 같은 컴포넌트(ArticleByline/ArticleBody/KeyTerms)를 쓴다.
// 본문(요약·인사이트·요지·핵심 용어)은 서버가 넘긴 news 로 바로 그린다. 예전에는 /api/news/[id] 를
// 다시 불러 그동안 로딩 표시 → 본문으로 바뀌며 높이가 튀었다(Gate 3). 이제 관련 기사만 따로 불러온다.
export function NewsDetailModal({ news, open, onOpenChange }: NewsDetailModalProps) {
  const locale = useLocale();
  const [relatedNews, setRelatedNews] = useState<RelatedSections>(EMPTY_RELATED);

  useEffect(() => {
    // 관련 기사로 연속 이동할 때 늦게 도착한 이전 기사 응답이 덮어쓰지 않도록 한다.
    let cancelled = false;
    if (open && news) {
      fetchRelatedNewsClient(news.id)
        .then((related) => {
          if (!cancelled) setRelatedNews(related);
        })
        .catch(() => {
          if (!cancelled) setRelatedNews(EMPTY_RELATED);
        });
    }
    if (!open) {
      setRelatedNews(EMPTY_RELATED);
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, news?.id]);

  if (!news) return null;

  const fullItem = news;
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

          <ArticleBody news={fullItem} locale={locale} headingTag="h3" />
          <KeyTerms terms={fullItem.key_terms} locale={locale} headingTag="h3" />

          {/* 관련 기사 세 묶음 — 상세 페이지와 같은 컴포넌트·같은 findRelated. 본문 아래 마지막 블록이라 늦게 도착해도
              위 내용이 밀리지 않는다(Gate 3) */}
          <RelatedSectionsView sections={relatedNews} locale={locale} variant="modal" headingTag="h3" />
        </div>
      </DialogContent>
    </Dialog>
  );
}
