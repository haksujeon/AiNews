"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

export function NewsCardSkeleton() {
  return (
    <Card className="overflow-hidden">
      <Skeleton className="h-48 w-full" />
      <CardContent className="p-5">
        <div className="flex items-center gap-2 mb-3">
          <Skeleton className="h-5 w-16" />
          <Skeleton className="h-5 w-20" />
        </div>
        <Skeleton className="h-6 w-full mb-2" />
        <Skeleton className="h-6 w-3/4 mb-4" />
        <Skeleton className="h-4 w-full mb-2" />
        <Skeleton className="h-4 w-2/3" />
        <div className="flex items-center justify-between mt-4 pt-4 border-t">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-20" />
        </div>
      </CardContent>
    </Card>
  );
}

export function NewsListItemSkeleton() {
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-col sm:flex-row">
        <Skeleton className="sm:w-56 h-48 sm:h-auto flex-shrink-0" />
        <div className="flex-1 p-5">
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <Skeleton className="h-5 w-16" />
            <Skeleton className="h-5 w-20" />
            <Skeleton className="h-5 w-24" />
          </div>
          <Skeleton className="h-7 w-full mb-2" />
          <Skeleton className="h-7 w-3/4 mb-3" />
          <Skeleton className="h-4 w-full mb-2" />
          <Skeleton className="h-4 w-2/3 mb-4" />
          <Skeleton className="h-4 w-24" />
        </div>
      </div>
    </Card>
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
        <Skeleton className="h-6 w-32" />
        {viewMode === "grid" ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <NewsCardSkeleton key={i} />
            ))}
          </div>
        ) : (
          <div className="space-y-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <NewsListItemSkeleton key={i} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
