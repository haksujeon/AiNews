"use client";

import { Skeleton } from "@/components/ui/skeleton";

// 실제 카드/리스트와 같은 골격(괘선 + 여백, 테두리 카드 없음)이라 로드 뒤 자리 이동이 적다.
export function NewsCardSkeleton() {
  return (
    <div className="space-y-2.5 border-t border-rule pt-4">
      <Skeleton className="mb-1 aspect-[16/9] w-full rounded-none" />
      <Skeleton className="h-3 w-24" />
      <Skeleton className="h-5 w-full" />
      <Skeleton className="h-5 w-3/4" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-2/3" />
    </div>
  );
}

export function NewsListItemSkeleton() {
  return (
    <div className="flex items-start gap-4 border-b border-rule py-4 sm:gap-6">
      <div className="flex-1 space-y-2">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-5 w-full" />
        <Skeleton className="h-5 w-3/4" />
        <Skeleton className="h-4 w-2/3" />
      </div>
      <Skeleton className="aspect-[4/3] w-24 shrink-0 rounded-none sm:w-40" />
    </div>
  );
}

export function NewsContainerSkeleton({ viewMode = "grid" }: { viewMode?: "grid" | "list" }) {
  return (
    <div className="space-y-6">
      {/* Filter skeleton */}
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Skeleton className="h-10 flex-1" />
          <Skeleton className="h-10 w-20" />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Skeleton className="h-9 w-32" />
          <Skeleton className="h-9 w-32" />
          <Skeleton className="h-9 w-20 ml-auto" />
        </div>
      </div>

      {/* Date group skeleton */}
      <div className="space-y-4">
        <Skeleton className="h-6 w-40" />
        {viewMode === "grid" ? (
          <div className="grid grid-cols-1 gap-x-8 gap-y-8 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <NewsCardSkeleton key={i} />
            ))}
          </div>
        ) : (
          <div>
            {Array.from({ length: 5 }).map((_, i) => (
              <NewsListItemSkeleton key={i} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
