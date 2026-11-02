"use client";

import { useState } from "react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { isAiGeneratedImage, isRealImage } from "@/lib/news-utils";

interface NewsThumbnailProps {
  src: string | null;
  alt: string;
  sizes: string;
  /** 이미지를 감싸는 박스 클래스. 크기는 aspect-ratio 로 고정한다(예: "aspect-[16/9] w-full"). */
  className?: string;
  imageClassName?: string;
  /** 좁은 썸네일(목록 행 등)에서는 AI 라벨을 짧은 문구로 쓴다. */
  compactLabel?: boolean;
}

/**
 * 카드/목록/상세/모달 공용 이미지.
 * - 이미지가 없거나, 플레이스홀더성 이미지(量子位 로고·아바타)거나, 로드에 실패하면
 *   아무것도 그리지 않는다(그라데이션 플레이스홀더 없음). 남는 폭은 텍스트가 쓴다.
 * - aspect-ratio 박스로 자리를 먼저 잡아 이미지 로드 시 레이아웃 이동이 없다.
 * - AI 생성 이미지(虎嗅 AI 커버)는 모서리에 "AI 생성 이미지" 라벨을 겹쳐 보이고 대체 텍스트에도 적는다.
 *   라벨은 박스 안에 absolute 로 겹치므로 레이아웃 이동이 없다.
 */
export function NewsThumbnail({ src, alt, sizes, className, imageClassName, compactLabel }: NewsThumbnailProps) {
  const [failed, setFailed] = useState(false);
  const t = useTranslations("common");

  if (!isRealImage(src) || failed) return null;

  const aiGenerated = isAiGeneratedImage(src);
  const aiLabel = t("aiImageLabel");
  const imageAlt = aiGenerated ? (alt ? `${alt} (${aiLabel})` : aiLabel) : alt;

  return (
    <div className={cn("relative overflow-hidden bg-surface", className)}>
      <Image
        src={src}
        alt={imageAlt}
        fill
        className={cn("object-cover", imageClassName)}
        sizes={sizes}
        referrerPolicy="no-referrer"
        unoptimized
        onError={() => setFailed(true)}
      />
      {aiGenerated && (
        <span
          aria-hidden="true"
          data-testid="ai-image-label"
          className="pointer-events-none absolute bottom-1.5 left-1.5 max-w-[calc(100%-0.75rem)] rounded-sm bg-black/75 px-1.5 py-0.5 text-xs leading-4 font-medium whitespace-nowrap text-white"
        >
          {compactLabel ? t("aiImageLabelShort") : aiLabel}
        </span>
      )}
    </div>
  );
}
