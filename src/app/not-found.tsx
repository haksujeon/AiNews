import { fontVariables } from "@/lib/fonts";
import { BASE_PATH } from "@/lib/api-path";
import "./globals.css";

// 로케일 레이아웃 바깥(잘못된 로케일 등)에서 난 404.
// 루트 레이아웃이 <html> 을 렌더하지 않으므로 여기서 직접 렌더한다.
export default function GlobalNotFound() {
  return (
    <html lang="ko" className="dark">
      <body className={`${fontVariables} antialiased`}>
        <main className="min-h-screen flex flex-col items-center justify-center gap-4 p-6 text-center">
          <p className="font-display text-5xl font-bold text-primary">404</p>
          <p className="text-muted-foreground">
            페이지를 찾을 수 없습니다 · Page not found · 页面不存在
          </p>
          <div className="flex gap-3 text-sm">
            {/* 로케일 컨텍스트가 없으므로 일반 <a> 로 각 언어 홈을 안내한다 */}
            <a className="underline hover:text-primary" href={`${BASE_PATH}/ko`}>한국어</a>
            <a className="underline hover:text-primary" href={`${BASE_PATH}/en`}>English</a>
            <a className="underline hover:text-primary" href={`${BASE_PATH}/zh`}>中文</a>
          </div>
        </main>
      </body>
    </html>
  );
}
