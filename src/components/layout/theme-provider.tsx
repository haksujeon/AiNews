"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

/**
 * 테마: 기본값은 OS 설정(prefers-color-scheme)을 따른다.
 * 사용자가 토글로 고르면 localStorage("theme")에 저장돼 다음 방문에도 유지된다.
 * next-themes 가 <head> 에 넣는 스크립트가 첫 페인트 전에 html.dark 를 정해 깜박임이 없다.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
