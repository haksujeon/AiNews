"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { NewsDetailModal } from "@/components/news/news-detail-modal";
import type { PublicNewsItem } from "@/lib/news-gist";

export function RouteNewsModal({ news }: { news: PublicNewsItem }) {
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
