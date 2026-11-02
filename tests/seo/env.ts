// 운영과 같은 절대 URL 이 나오게 basePath·원점을 고정한다. 테스트 파일에서 가장 먼저 import 한다
// (src/lib/site.ts·api-path.ts 가 모듈을 읽을 때 환경 변수를 한 번 읽는다).
process.env.NEXT_PUBLIC_BASE_PATH = "/ainews";
process.env.SITE_URL = "https://news.aibaseclub.com";
