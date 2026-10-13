"use client";

import { useState } from "react";
import Image from "next/image";
import { cn } from "@/lib/utils";
import { isRealImage } from "@/lib/news-utils";

interface NewsThumbnailProps {
  src: string | null;
  alt: string;
  sizes: string;
  /** 이미지를 감싸는 박스 클래스. 크기는 aspect-ratio 로 고정한다(예: "aspect-[16/9] w-full"). */
  className?: string;
  imageClassName?: string;
}

/**
 * 카드/목록/상세/모달 공용 이미지.
 * - 이미지가 없거나, 플레이스홀더성 이미지(虎嗅 AI 커버, 量子位 로고)거나, 로드에 실패하면
 *   아무것도 그리지 않는다(그라데이션 플레이스홀더 없음). 남는 폭은 텍스트가 쓴다.
 * - aspect-ratio 박스로 자리를 먼저 잡아 이미지 로드 시 레이아웃 이동이 없다.
 */
export function NewsThumbnail({ src, alt, sizes, className, imageClassName }: NewsThumbnailProps) {
  const [failed, setFailed] = useState(false);

  if (!isRealImage(src) || failed) return null;

  return (
    <div className={cn("relative overflow-hidden bg-surface", className)}>
      <Image
        src={src}
        alt={alt}
        fill
        className={cn("object-cover", imageClassName)}
        sizes={sizes}
        referrerPolicy="no-referrer"
        unoptimized
        onError={() => setFailed(true)}
      />
    </div>
  );
}
