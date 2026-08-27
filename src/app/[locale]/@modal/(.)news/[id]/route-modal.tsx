"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { NewsDetailModal } from "@/components/news/news-detail-modal";
import type { NewsItem } from "@/lib/supabase";

export function RouteNewsModal({ news }: { news: NewsItem }) {
  const router = useRouter();
  const [open, setOpen] = useState(true);

  return (
    <NewsDetailModal
      news={news}
      open={open}
      onOpenChange={(isOpen) => {
        setOpen(isOpen);
        if (!isOpen) router.back();
      }}
    />
  );
}
