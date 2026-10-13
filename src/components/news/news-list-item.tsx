"use client";

import { useLocale } from "next-intl";
import { Link } from "@/i18n/navigation";
import type { NewsItem } from "@/lib/supabase";
import { getTitle, getSummary, getImageUrl } from "@/lib/news-utils";
import { NewsThumbnail } from "./news-thumbnail";
import { ArticleKicker } from "./article-kicker";

interface NewsListItemProps {
  item: NewsItem;
}

/**
 * 리스트 보기용 기사 항목. NewsCard 와 같은 링크(/news/[id]) — 모달/전체페이지 동작 동일.
 * 텍스트 왼쪽, 작은 썸네일 오른쪽(모바일에서도 위로 쌓지 않는다). 항목 사이는 괘선.
 */
export function NewsListItem({ item }: NewsListItemProps) {
  const locale = useLocale();
  const title = getTitle(item, locale);
  const summary = getSummary(item, locale);

  return (
    <Link
      href={`/news/${item.id}`}
      prefetch={false}
      // 모달(가로채기 라우트)로 열 때 배경 목록의 스크롤 위치를 유지한다.
      scroll={false}
      className="group block rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-background"
    >
      <article className="flex items-start gap-4 border-b border-rule py-4 sm:gap-6">
        <div className="min-w-0 flex-1 space-y-2">
          <ArticleKicker category={item.category} sourceName={item.source_name} locale={locale} />
          <h2 className="text-[17px] font-semibold leading-[1.45] tracking-[-0.015em] text-ink decoration-1 underline-offset-[3px] group-hover:underline sm:text-lg">
            {title}
          </h2>
          {summary && (
            <p className="text-sm leading-relaxed text-ink-2 line-clamp-3 sm:line-clamp-2">{summary}</p>
          )}
        </div>
        <NewsThumbnail
          src={getImageUrl(item)}
          alt=""
          className="aspect-[4/3] w-24 shrink-0 sm:w-40"
          sizes="(max-width: 640px) 96px, 160px"
        />
      </article>
    </Link>
  );
}
