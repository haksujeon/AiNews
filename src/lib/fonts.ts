import { Geist, Geist_Mono, Outfit } from "next/font/google";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const outfit = Outfit({
  variable: "--font-outfit",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

/** <body> 에 붙이는 폰트 CSS 변수 클래스 */
export const fontVariables = `${geistSans.variable} ${geistMono.variable} ${outfit.variable}`;
