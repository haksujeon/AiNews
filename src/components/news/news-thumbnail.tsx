"use client";

import { useState } from "react";
import Image from "next/image";
import { cn } from "@/lib/utils";
import { NewsPlaceholder } from "./news-placeholder";

interface NewsThumbnailProps {
  src: string | null;
  alt: string;
  category: string | null;
  sizes: string;
  /** 이미지/플레이스홀더를 감싸는 박스 클래스(크기 지정) */
  className?: string;
  imageClassName?: string;
  children?: React.ReactNode;
}

/**
 * 카드/목록 썸네일. 원격 이미지가 깨지면(핫링크 차단, 404 등) 카테고리 플레이스홀더로 대체한다.
 * 모달/상세의 히어로 이미지 onError 처리와 같은 목적.
 */
export function NewsThumbnail({
  src,
  alt,
  category,
  sizes,
  className,
  imageClassName,
  children,
}: NewsThumbnailProps) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return <NewsPlaceholder category={category} className={className} />;
  }

  return (
    <div className={cn("overflow-hidden bg-muted/50 relative", className)}>
      <Image
        src={src}
        alt={alt}
        fill
        className={imageClassName}
        sizes={sizes}
        referrerPolicy="no-referrer"
        unoptimized
        onError={() => setFailed(true)}
      />
      {children}
    </div>
  );
}
