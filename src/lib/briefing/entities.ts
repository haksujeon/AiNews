/**
 * 기업·기관 이름표 (후보 점수, 중국 중심 규칙, refs 관련성 검사가 함께 쓴다).
 *
 * 한 항목 = 같은 실체의 여러 표기(한국어·영문·중국어·대표 제품명).
 * 한국어 별칭은 다른 낱말의 앞부분과 겹치지 않게 필요한 곳에 lookahead 를 둔다
 * (예: "메타" 가 "메타버스" 에 걸리면 안 된다).
 */

export interface Entity {
  key: string;
  aliases: (string | RegExp)[];
  chinese: boolean;
  /** §3.2 기업 등급: 중국 주요 기업 1.0 / 중국과 얽힌 해외 빅테크 0.6 / 그 밖 0 */
  tier: number;
}

export const ENTITIES: Entity[] = [
  // ── 중국 주요 기업 (등급 1.0)
  { key: "bytedance", chinese: true, tier: 1, aliases: ["바이트댄스", "ByteDance", "字节", "더우바오", "Doubao", "豆包", "Seedance", "Volcano Engine", "火山引擎", "볼케이노"] },
  { key: "alibaba", chinese: true, tier: 1, aliases: ["알리바바", "Alibaba", "阿里", "Qwen", "큐원", "치엔원", "千问", "통의", "通义", "알리클라우드", "阿里云"] },
  { key: "tencent", chinese: true, tier: 1, aliases: ["텐센트", "Tencent", "腾讯", "훈위안", "Hunyuan", "混元", "위챗", "WeChat", "微信", "QClaw"] },
  { key: "huawei", chinese: true, tier: 1, aliases: ["화웨이", "Huawei", "华为", "어센드", "Ascend", "昇腾", "성텅"] },
  { key: "deepseek", chinese: true, tier: 1, aliases: ["딥시크", "DeepSeek", "深度求索", "량원펑", "梁文锋"] },
  { key: "moonshot", chinese: true, tier: 1, aliases: ["문샷", "Moonshot", "월지암면", "月之暗面", "Kimi", "키미"] },
  { key: "zhipu", chinese: true, tier: 1, aliases: ["지푸", "Zhipu", "智谱", /\bGLM\b/, "Z.ai"] },
  { key: "minimax", chinese: true, tier: 1, aliases: ["미니맥스", "MiniMax", "稀宇"] },
  { key: "baidu", chinese: true, tier: 1, aliases: ["바이두", "Baidu", "百度", "어니", "ERNIE", "文心"] },
  { key: "xiaomi", chinese: true, tier: 1, aliases: ["샤오미", "Xiaomi", "小米"] },
  // ── 그 밖의 중국 기업·기관 (중국 중심 규칙 판정용, 점수 0.5)
  { key: "cambricon", chinese: true, tier: 0.5, aliases: ["캄브리콘", "Cambricon", "寒武纪"] },
  { key: "smic", chinese: true, tier: 0.5, aliases: ["SMIC", "중신궈지", "中芯"] },
  { key: "cxmt", chinese: true, tier: 0.5, aliases: ["창신메모리", "CXMT", "长鑫"] },
  { key: "unitree", chinese: true, tier: 0.5, aliases: ["유니트리", "Unitree", "宇树"] },
  { key: "infinigence", chinese: true, tier: 0.5, aliases: ["무문신궁", "無問芯穹", "无问芯穹", "Infinigence"] },
  { key: "astribot", chinese: true, tier: 0.5, aliases: ["성진지능", "Astribot", "星尘智能"] },
  { key: "meituan", chinese: true, tier: 0.5, aliases: ["메이투안", "Meituan", "美团"] },
  { key: "kuaishou", chinese: true, tier: 0.5, aliases: ["콰이쇼우", "Kuaishou", "快手", "Kling", "커링", "可灵"] },
  { key: "jd", chinese: true, tier: 0.5, aliases: ["징둥", "京东", "JD.com"] },
  { key: "stepfun", chinese: true, tier: 0.5, aliases: ["스텝펀", "StepFun", "阶跃"] },
  { key: "sensetime", chinese: true, tier: 0.5, aliases: ["센스타임", "상탕", "SenseTime", "商汤"] },
  { key: "iflytek", chinese: true, tier: 0.5, aliases: ["아이플라이텍", "iFlytek", "科大讯飞", "커다쉰페이"] },
  { key: "byd", chinese: true, tier: 0.5, aliases: ["비야디", "BYD", "比亚迪"] },
  { key: "horizon", chinese: true, tier: 0.5, aliases: ["호라이즌 로보틱스", "Horizon Robotics", "地平线"] },
  { key: "ant", chinese: true, tier: 0.5, aliases: ["앤트그룹", "Ant Group", "蚂蚁集团"] },
  { key: "cn_gov", chinese: true, tier: 0.5, aliases: ["중국 정부", "국무원", "国务院", "공업정보화부", "공신부", "工信部", "국가발전개혁위원회", "发改委", "중국과학원", "中国科学院", "칭화대", "清华", "베이징대", "北京大学", "중국 당국", "중국 상무부", "商务部"] },
  // ── 중국 시장과 얽힌 해외 빅테크 (등급 0.6)
  { key: "nvidia", chinese: false, tier: 0.6, aliases: ["엔비디아", "NVIDIA", "Nvidia", "英伟达"] },
  { key: "apple", chinese: false, tier: 0.6, aliases: ["애플", "Apple", "苹果"] },
  { key: "tesla", chinese: false, tier: 0.6, aliases: ["테슬라", "Tesla", "特斯拉"] },
  { key: "meta", chinese: false, tier: 0.6, aliases: [/메타(?!버스|데이터|인지|포)/, /\bMeta\b/, "扎克伯格", "저커버그", /\bLlama\b/, "Muse Wonder"] },
  { key: "google", chinese: false, tier: 0.6, aliases: ["구글", "Google", "谷歌", "Gemini", "제미나이", "DeepMind", "딥마인드"] },
  { key: "microsoft", chinese: false, tier: 0.6, aliases: ["마이크로소프트", "Microsoft", "微软"] },
  { key: "openai", chinese: false, tier: 0.6, aliases: ["오픈AI", "OpenAI", /\bGPT\b/, "ChatGPT", "챗GPT"] },
  { key: "anthropic", chinese: false, tier: 0.6, aliases: ["앤트로픽", "Anthropic", "Claude", "클로드"] },
  { key: "amd", chinese: false, tier: 0.6, aliases: [/\bAMD\b/] },
  { key: "intel", chinese: false, tier: 0.6, aliases: ["인텔", /\bIntel\b/, "英特尔"] },
  { key: "tsmc", chinese: false, tier: 0.6, aliases: ["TSMC", "台积电", "타이완 반도체"] },
  { key: "samsung", chinese: false, tier: 0.6, aliases: ["삼성", "Samsung", "三星"] },
];

function aliasMatches(alias: string | RegExp, text: string): boolean {
  if (typeof alias === "string") return text.includes(alias);
  return alias.test(text);
}

/** 텍스트에 나오는 실체 목록 */
export function findEntities(text: string): Entity[] {
  return ENTITIES.filter((e) => e.aliases.some((a) => aliasMatches(a, text)));
}

export function entityMentioned(entity: Entity, text: string): boolean {
  return entity.aliases.some((a) => aliasMatches(a, text));
}

/** 텍스트 안 최고 기업 등급 (점수용) */
export function maxEntityTier(text: string): number {
  return findEntities(text).reduce((m, e) => Math.max(m, e.tier), 0);
}

/** 중국 기업·기관이 주체인지 (중국 중심 규칙) */
export function isChineseSubject(text: string): boolean {
  if (/중국|中国|베이징|상하이|선전|심천|항저우|北京|上海|深圳|杭州/.test(text)) return true;
  return findEntities(text).some((e) => e.chinese);
}

/**
 * refs 관련성 검사용 고유명사 토큰.
 * 이름표에 있는 실체 + 이름표에 없는 라틴 문자 고유명사(대문자나 숫자를 포함한 토큰).
 */
const LATIN_STOP = new Set([
  "AI", "AGI", "ASI", "GPU", "GPUs", "CPU", "NPU", "TPU", "API", "APIs", "LLM", "LLMs", "App", "IPO", "CEO", "CTO",
  "CFO", "VC", "PR", "PRs", "EA", "MW", "GW", "KW", "TB", "GB", "PB", "SaaS", "B2B", "B2C", "OS", "UI", "UX", "AR",
  "VR", "XR", "PC", "IT", "R&D", "DRAM", "HBM", "NAND", "SoC", "RL", "RAG", "MoE", "SOTA", "US", "USA", "EU", "UN",
  "AIGC", "IoT", "SDK", "Pro", "Max", "Plus", "Ultra", "Mini", "Lite", "Full", "Code", "Agent", "Agents", "Token",
  "Tokens", "Steam", "GitHub", "Q1", "Q2", "Q3", "Q4", "H1", "H2", "AI칩",
]);

export interface ProperNoun {
  label: string;
  matches: (text: string) => boolean;
}

export function properNouns(sentence: string): ProperNoun[] {
  const out: ProperNoun[] = [];
  const covered: string[] = [];
  for (const e of findEntities(sentence)) {
    out.push({ label: e.key, matches: (t) => entityMentioned(e, t) });
    for (const a of e.aliases) if (typeof a === "string") covered.push(a.toLowerCase());
  }
  const latin = sentence.match(/[A-Za-z][A-Za-z0-9]*(?:[.\-+][A-Za-z0-9]+)*/g) ?? [];
  for (const tok of latin) {
    if (tok.length < 2 || LATIN_STOP.has(tok)) continue;
    if (!/[A-Z0-9]/.test(tok)) continue; // 소문자 일반 낱말 제외
    if (covered.some((c) => c.includes(tok.toLowerCase()))) continue;
    if (out.some((p) => p.label === tok)) continue;
    const lower = tok.toLowerCase();
    out.push({ label: tok, matches: (t) => t.toLowerCase().includes(lower) });
  }
  return out;
}
