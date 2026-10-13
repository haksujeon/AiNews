// <html>/<body> 는 로케일별 lang 을 넣기 위해 src/app/[locale]/layout.tsx 에서 렌더한다
// (next-intl 권장 구조). 루트 레이아웃은 children 만 통과시킨다.
// 로케일 밖에서 발생한 404 는 src/app/not-found.tsx 가 자체 <html> 로 처리한다.
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
