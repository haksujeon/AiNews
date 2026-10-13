import { Geist_Mono, Noto_Sans_SC } from "next/font/google";
import { BASE_PATH } from "@/lib/api-path";

/**
 * 본문·UI 서체: Pretendard Variable (SIL OFL 1.1, public/fonts/pretendard/OFL.txt).
 * - next/font/local 은 파일별 unicode-range 를 못 쓰므로 next/font 를 쓰지 않고,
 *   공식 dynamic-subset CSS(92조각, unicode-range 분할)를 public/ 에 두고 <link> 로 건다.
 *   브라우저는 화면에 실제로 쓰인 글자의 조각만 받는다(미리 받기 없음, font-display: swap).
 * - 교체 시 밀림은 globals.css 의 "Pretendard Fallback"(size-adjust 등)으로 줄인다.
 * - zh 페이지는 이 CSS 를 걸지 않는다(본문은 Noto Sans SC).
 */
export const PRETENDARD_CSS_HREF = `${BASE_PATH}/fonts/pretendard/pretendard-dynamic-subset.css`;

/**
 * zh 로케일 본문: Noto Sans SC. Google 이 유니코드 범위로 쪼개 주므로 필요한 조각만 받는다.
 * 가변 폰트(굵기 축) 한 벌만 받아 400~700 을 모두 쓴다 — 고정 굵기 여러 벌보다 조각 수가 적다.
 * 미리 받지 않음(preload:false). 적용은 globals.css 의 :lang(zh).
 */
const notoSansSC = Noto_Sans_SC({
  variable: "--font-noto-sc",
  weight: "variable",
  display: "swap",
  preload: false,
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  preload: false,
});

/** <html> 에 붙이는 폰트 CSS 변수 클래스 */
export const fontVariables = `${notoSansSC.variable} ${geistMono.variable}`;
