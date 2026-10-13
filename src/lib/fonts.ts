import localFont from "next/font/local";
import { Geist_Mono, Noto_Sans_SC } from "next/font/google";

/**
 * 본문·UI 서체: Pretendard Variable (SIL OFL 1.1, src/fonts/pretendard/OFL.txt).
 * - 직접 호스팅(next/font/local). 가변 폰트 하나로 굵기 45~920 을 쓴다.
 * - next/font/local 은 파일별 unicode-range 를 지원하지 않아 92조각 dynamic-subset 대신
 *   전체 가변 woff2(약 2.0MB)를 쓴다. 한 번 받으면 브라우저 캐시로 재사용된다.
 * - adjustFontFallback(기본 Arial)이 size-adjust/ascent-override 를 맞춘 대체 서체를
 *   만들어 폰트 교체 시 레이아웃 이동(CLS)을 줄인다.
 */
const pretendard = localFont({
  src: "../fonts/pretendard/PretendardVariable.woff2",
  variable: "--font-pretendard",
  weight: "45 920",
  display: "swap",
  fallback: [
    "-apple-system",
    "BlinkMacSystemFont",
    "Apple SD Gothic Neo",
    "Malgun Gothic",
    "Noto Sans KR",
    "system-ui",
    "sans-serif",
  ],
});

/**
 * zh 로케일 본문: Noto Sans SC. Google 이 유니코드 범위로 쪼개 주므로 필요한 조각만 받는다.
 * 모든 페이지에서 미리 받지 않도록 preload:false. 적용은 globals.css 의 :lang(zh).
 */
const notoSansSC = Noto_Sans_SC({
  variable: "--font-noto-sc",
  weight: ["400", "500", "600", "700"],
  display: "swap",
  preload: false,
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/** <html> 에 붙이는 폰트 CSS 변수 클래스 (Tailwind preflight 가 html 에서 font-family 를 계산하므로 html 에 둔다) */
export const fontVariables = `${pretendard.variable} ${notoSansSC.variable} ${geistMono.variable}`;
