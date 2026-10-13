"use client";

import { useLocale } from "next-intl";
import { Link } from "@/i18n/navigation";
import type { NewsItem } from "@/lib/supabase";
import { getTitle, getSummary, getImageUrl } from "@/lib/news-utils";
import { NewsThumbnail } from "./news-thumbnail";
import { ArticleKicker } from "./article-kicker";

interface NewsCardProps {
  item: NewsItem;
}

/**
 * 기사 카드. 실제 링크(/[locale]/news/[id])라서 탭 이동·새 탭 열기·주소 공유가 된다.
 * 소프트 이동이면 @modal/(.)news/[id] 가로채기 라우트가 모달로 열고,
 * 직접 접속/새로고침이면 전체 상세 페이지가 렌더된다. (목록/리스트/관련기사 모두 같은 경로)
 *
 * 표면: 테두리·둥근 모서리·그림자·블러 없이 위쪽 괘선과 여백으로만 구분한다.
 */
export function NewsCard({ item }: NewsCardProps) {
  const locale = useLocale();
  const title = getTitle(item, locale);
  const summary = getSummary(item, locale);

  return (
    <Link
      href={`/news/${item.id}`}
      prefetch={false}
      // 모달(가로채기 라우트)로 열 때 배경 목록의 스크롤 위치를 유지한다.
      scroll={false}
      className="group block h-full rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-background"
    >
      <article className="flex h-full flex-col gap-2.5 border-t border-rule pt-4">
        <NewsThumbnail
          src={getImageUrl(item)}
          alt=""
          className="mb-1 aspect-[16/9] w-full"
          sizes="(max-width: 768px) 100vw, (max-width: 1024px) 50vw, (max-width: 1280px) 33vw, 25vw"
        />
        <ArticleKicker category={item.category} sourceName={item.source_name} locale={locale} />
        <h2 className="text-[17px] font-semibold leading-[1.45] tracking-[-0.015em] text-ink line-clamp-3 decoration-1 underline-offset-[3px] group-hover:underline">
          {title}
        </h2>
        {summary && (
          <p className="text-sm leading-relaxed text-ink-2 line-clamp-3">{summary}</p>
        )}
      </article>
    </Link>
  );
}
