import { Geist_Mono } from "next/font/google";
import { BASE_PATH } from "@/lib/api-path";

/**
 * 본문·UI 서체: Pretendard Variable (SIL OFL 1.1, public/fonts/pretendard/OFL.txt).
 * - next/font/local 은 파일별 unicode-range 를 못 쓰므로 next/font 를 쓰지 않고,
 *   공식 dynamic-subset CSS(92조각, unicode-range 분할)를 public/ 에 두고 <link> 로 건다.
 *   브라우저는 화면에 실제로 쓰인 글자의 조각만 받는다(미리 받기 없음, font-display: swap).
 * - 교체 시 밀림은 globals.css 의 "Pretendard Fallback"(size-adjust 등)으로 줄인다.
 * - zh 페이지는 이 CSS 를 걸지 않는다. zh 는 웹폰트 없이 시스템 중국어 서체를 쓴다(globals.css :lang(zh)).
 *   첫 목록 30건의 한자가 700자 이상이라 웹폰트(Noto Sans SC)는 1.4MB 가까이 받아야 했다.
 */
export const PRETENDARD_CSS_HREF = `${BASE_PATH}/fonts/pretendard/pretendard-dynamic-subset.css`;

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  preload: false,
});

/** <html> 에 붙이는 폰트 CSS 변수 클래스 */
export const fontVariables = geistMono.variable;
