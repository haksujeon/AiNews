/**
 * 공유 카드(OG 이미지) 공용 레이아웃 (P0-3). 기사·브리핑 opengraph-image 와 로고가 이 파일만 쓴다 (Gate 2).
 *
 * 결정 D3: 원문 기사 이미지·虎嗅 AI 커버 등 제3자 이미지는 쓰지 않는다. 카드는 글자만으로 만든다.
 * 글꼴: next/og 기본 글꼴은 라틴 문자뿐이라 일부 글자 묶음을 직접 싣는다(assets/fonts, OFL 1.1).
 *  - Pretendard Bold: KS X 1001 한글 2350자 + 라틴 (+ 실제 기사 제목에 쓰인 한글)
 *  - Noto Sans SC Bold: GB2312 1·2급 한자 6763자 + 문장부호 (+ 실제 제목에 쓰인 한자) — ko 제목의 남은 한자·매체명(虎嗅 등)도 이 글꼴로
 * 언어에 따라 앞 글꼴만 바꾸고, 없는 글자는 다음 글꼴에서 찾는다. 서버 전용(fs).
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";
import { clipText } from "@/lib/seo/text";

export const OG_SIZE = { width: 1200, height: 630 };
export const OG_CONTENT_TYPE = "image/png";

const FONT_DIR = path.join(process.cwd(), "assets", "fonts");
const KO = "Pretendard";
const SC = "Noto Sans SC";

let fontsPromise: Promise<{ name: string; data: Buffer; weight: 700; style: "normal" }[]> | null = null;

/** 글꼴은 프로세스마다 한 번만 읽는다 */
function loadFonts() {
  fontsPromise ??= Promise.all([
    readFile(path.join(FONT_DIR, "Pretendard-Bold.subset.otf")),
    readFile(path.join(FONT_DIR, "NotoSansSC-Bold.subset.otf")),
  ]).then(([ko, sc]) => [
    { name: KO, data: ko, weight: 700 as const, style: "normal" as const },
    { name: SC, data: sc, weight: 700 as const, style: "normal" as const },
  ]);
  fontsPromise.catch(() => (fontsPromise = null));
  return fontsPromise;
}

function fontFamily(locale: string): string {
  return locale === "zh" ? `"${SC}", "${KO}"` : `"${KO}", "${SC}"`;
}

/** 언어별 제목 최대 글자 수 (3줄 안쪽) */
const TITLE_MAX: Record<string, number> = { ko: 64, en: 110, zh: 48 };

function titleSize(title: string, locale: string): number {
  const n = [...title].length;
  const wide = locale === "en" ? n / 1.8 : n; // 라틴 글자는 대략 절반 폭
  if (wide <= 22) return 72;
  if (wide <= 36) return 62;
  return 54;
}

// globals.css 의 밝은 테마 토큰
const C = { paper: "#fbfbfa", ink: "#16171a", ink2: "#43464d", ink3: "#61656e", rule: "#e2e2de", jade: "#0b6457" };

export interface OgCardInput {
  locale: string;
  brand: string;
  /** 제목 위 작은 머리글: 분류 라벨 또는 "중국 AI 브리핑" */
  kicker: string;
  title: string;
  /** 아래 줄: 매체·날짜 등 (빈 값은 뺀다) */
  meta: (string | null | undefined)[];
  /** 오른쪽 아래 사이트 표기 */
  site: string;
}

export function OgCard({ locale, brand, kicker, title, meta, site }: OgCardInput) {
  const t = clipText(title, TITLE_MAX[locale] ?? TITLE_MAX.ko);
  const metaLine = meta.filter(Boolean).join("  ·  ");
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: C.paper,
        color: C.ink,
        fontFamily: fontFamily(locale),
        padding: "0 80px",
      }}
    >
      <div style={{ display: "flex", height: 14, background: C.jade, margin: "0 -80px" }} />
      <div style={{ display: "flex", alignItems: "center", marginTop: 56, fontSize: 30 }}>
        <span style={{ fontSize: 34, letterSpacing: "-0.02em" }}>{brand}</span>
        <span style={{ display: "flex", width: 2, height: 30, background: C.rule, margin: "0 22px" }} />
        <span style={{ color: C.jade }}>{kicker}</span>
      </div>
      <div
        style={{
          display: "flex",
          flex: 1,
          alignItems: "center",
          fontSize: titleSize(t, locale),
          lineHeight: 1.28,
          letterSpacing: locale === "en" ? "-0.01em" : "-0.02em",
          // 한국어는 어절 단위로 줄바꿈, 중국어는 글자 사이 어디서나(keep-all 이면 줄이 안 바뀐다)
          wordBreak: locale === "ko" ? "keep-all" : "normal",
        }}
      >
        {t}
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          borderTop: `2px solid ${C.ink}`,
          padding: "26px 0 44px",
          fontSize: 28,
          color: C.ink2,
        }}
      >
        <span>{metaLine}</span>
        <span style={{ fontSize: 24, color: C.ink3 }}>{site}</span>
      </div>
    </div>
  );
}

/** opengraph-image 가 돌려줄 PNG (1200×630) */
export async function renderOgCard(input: OgCardInput): Promise<ImageResponse> {
  return new ImageResponse(<OgCard {...input} />, { ...OG_SIZE, fonts: await loadFonts() });
}

/** 발행자 로고(정사각 PNG) — JSON-LD publisher.logo */
export async function renderLogo(brand: string, size: number): Promise<ImageResponse> {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: C.paper,
          color: C.ink,
          fontFamily: `"${KO}"`,
        }}
      >
        <div style={{ display: "flex", fontSize: size * 0.2, letterSpacing: "-0.03em" }}>{brand}</div>
        <div style={{ display: "flex", width: size * 0.42, height: size * 0.035, background: C.jade, marginTop: size * 0.05 }} />
      </div>
    ),
    { width: size, height: size, fonts: await loadFonts() }
  );
}

/** "https://news.aibaseclub.com/ainews" → "news.aibaseclub.com/ainews" */
export function siteLabel(rootUrl: string): string {
  return rootUrl.replace(/^https?:\/\//, "").replace(/\/$/, "");
}
