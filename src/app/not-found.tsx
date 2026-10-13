import { fontVariables } from "@/lib/fonts";
import { BASE_PATH } from "@/lib/api-path";
import "./globals.css";

// 로케일 레이아웃 바깥(잘못된 로케일 등)에서 난 404.
// 루트 레이아웃이 <html> 을 렌더하지 않으므로 여기서 직접 렌더한다.
// ThemeProvider 밖이므로 OS 설정만 따른다(globals.css 토큰의 라이트 기본값).
export default function GlobalNotFound() {
  return (
    // Pretendard CSS 는 걸지 않는다: 여기 <link> 를 두면 React 가 모든 페이지(zh 포함)에 preload 힌트를 넣는다.
    // 드문 화면이라 시스템 서체로 충분하다.
    <html lang="ko" className={fontVariables}>
      <body className="antialiased">
        <main className="min-h-screen max-w-2xl mx-auto flex flex-col justify-center gap-4 px-4 py-16">
          <p className="text-sm font-semibold text-ink-3">404</p>
          <h1 className="text-2xl font-bold tracking-tight">
            페이지를 찾을 수 없습니다 · Page not found · 页面不存在
          </h1>
          <div className="flex gap-4 text-sm border-t border-rule pt-4">
            {/* 로케일 컨텍스트가 없으므로 일반 <a> 로 각 언어 홈을 안내한다 */}
            <a className="underline underline-offset-4 hover:text-jade" href={`${BASE_PATH}/ko`}>한국어</a>
            <a className="underline underline-offset-4 hover:text-jade" href={`${BASE_PATH}/en`}>English</a>
            <a className="underline underline-offset-4 hover:text-jade" href={`${BASE_PATH}/zh`} lang="zh-CN">中文</a>
          </div>
        </main>
      </body>
    </html>
  );
}
