/**
 * 한국어 표기 사전 — 중국 회사·제품·기관 이름과 AI 용어를 한국어로 어떻게 쓰는지 한 곳에 둔다 (2026-11-06 사용자 승인 "제안대로").
 *
 * 원칙 (2026-11-06 사용자 결정)
 *  - 회사·제품: 한국 언론 표기 우선 → 없으면 영문 공식 이름. 한자음 읽기(유수과기·상탕·면벽지능)는 쓰지 않는다.
 *  - 사람: 중국어 원음 (량원펑·왕싱싱 — 지금과 같음)
 *  - 용어: 한국 업계 표준. 具身智能 = "피지컬 AI"
 *
 * 쓰는 곳 (Gate 2 — 같은 표기는 어디서나 같은 결과)
 *  - ko-names.ts normalizeKoNames: fix 표기를 ko 로 자동으로 고친다 (기사 저장·데일리/주간/월간 검증·히스토리·쉬운 AI 설명·일괄 정리)
 *  - han-glossary.ts: 한국어 글에 남은 한자 이름(company·product·org 의 zh)을 ko 로
 *  - entities.ts: 실체 별칭 맨 앞에 ko 를 둔다 (이름표·번역 대조)
 *  - n8n 번역 지시 (scripts/n8n-*-prompt): 그 기사 원문에 나온 항목만 골라 "이렇게 쓰고(ko) 이렇게 쓰지 말 것(fix+avoid)"
 *
 * fix: 자동으로 고칠 잘못된 표기 — 다른 낱말과 겹칠 위험이 없는 것만. 3자 이하 한글 표기는 낱말 경계(앞뒤 한글 없음, 조사 허용)에서만 고친다.
 * avoid: 자동으로 고치지 않고 번역 지시에서만 "쓰지 말 것"으로 알린다 (짧거나 다른 낱말과 겹침: 산력 ⊂ 생산력, 착지 ⊂ 종착지)
 * hanSkip: han-glossary 에 넣지 않을 중국어 표기 (일반 낱말·지명과 겹침: 理想 = 이상, 宁德 = 지명)
 */
export type GlossKind = "company" | "product" | "org" | "term";
export interface GlossEntry {
  kind: GlossKind;
  /** 정한 한국어 표기 */
  ko: string;
  zh: string[];
  en?: string;
  fix?: string[];
  avoid?: string[];
  hanSkip?: string[];
  /** 실체 별칭(entities.ts)에 넣지 않는다 — 다른 뜻과 겹치는 이름 (푸리에 = 푸리에 변환) */
  noAlias?: true;
  note?: string;
}

export const KO_GLOSSARY: readonly GlossEntry[] = [
  // ── 회사 (한국 언론 표기)
  { kind: "company", ko: "유니트리", zh: ["宇树", "宇树科技"], en: "Unitree", fix: ["유수과기", "유수 과학기술", "유수테크", "우수커지", "유수커지", "유수트"], avoid: ["유수"] },
  { kind: "company", ko: "센스타임", zh: ["商汤", "商汤科技"], en: "SenseTime", fix: ["상탕과기", "상탕커지", "상탕"] },
  { kind: "company", ko: "애지봇", zh: ["智元机器人", "智元"], en: "AgiBot", fix: ["지원로봇", "지원 로봇", "즈위안 로봇", "즈위안로봇", "지위안로봇", "지위안 로봇"], avoid: ["지원", "즈위안"], hanSkip: ["智元"], note: "智元 단독은 매체 新智元 과 겹친다" },
  { kind: "company", ko: "갤봇", zh: ["银河通用"], en: "Galbot", fix: ["은하통용", "은하범용", "인허퉁융"] },
  { kind: "company", ko: "유비테크", zh: ["优必选"], en: "UBTech", fix: ["우필선"] },
  { kind: "company", ko: "푸리에", zh: ["傅利叶"], en: "Fourier", fix: ["부리엽"], noAlias: true, note: "'푸리에 변환'과 겹쳐 실체 별칭에는 넣지 않는다" },
  { kind: "company", ko: "모델베스트", zh: ["面壁智能"], en: "ModelBest", fix: ["면벽지능", "몐비즈넝", "몐비 즈넝"] },
  { kind: "company", ko: "스텝펀", zh: ["阶跃星辰", "阶跃"], en: "StepFun", fix: ["계약성신", "제웨싱천"] },
  { kind: "company", ko: "미니맥스", zh: ["稀宇", "稀宇科技"], en: "MiniMax" },
  { kind: "company", ko: "바이촨", zh: ["百川智能", "百川"], en: "Baichuan", fix: ["백천지능"], hanSkip: ["百川"] },
  { kind: "company", ko: "즈푸", zh: ["智谱", "智谱AI"], en: "Zhipu", fix: ["지보AI", "지보 AI", "지푸"], note: "기사 다수 '즈푸' (2026-11-06 결정). 지푸 → 즈푸" },
  { kind: "company", ko: "문샷AI", zh: ["月之暗面"], en: "Moonshot AI", fix: ["월지암면", "월지암", "월의 어두운 면", "문샷 AI", "문샷"], note: "2026-11-05 결정" },
  { kind: "company", ko: "딥시크", zh: ["深度求索"], en: "DeepSeek", fix: ["심도구색"] },
  { kind: "company", ko: "아이플라이텍", zh: ["科大讯飞"], en: "iFlytek", fix: ["커다쉰페이", "커다 쉰페이", "과대신비"] },
  { kind: "company", ko: "캄브리콘", zh: ["寒武纪"], en: "Cambricon", fix: ["한무기"] },
  { kind: "company", ko: "무어스레드", zh: ["摩尔线程"], en: "Moore Threads", fix: ["모어스레드", "마얼셴청", "모얼셴청"] },
  { kind: "company", ko: "메타엑스", zh: ["沐曦"], en: "MetaX", fix: ["목희", "목시"], avoid: ["무시"] },
  { kind: "company", ko: "비렌", zh: ["壁仞", "壁仞科技"], en: "Biren", fix: ["벽인과기", "비렌과기"], avoid: ["비런"] },
  { kind: "company", ko: "하이곤", zh: ["海光信息", "海光"], en: "Hygon", fix: ["하이광 정보", "하이광정보", "해광정보"], avoid: ["하이광"] },
  { kind: "company", ko: "쿤룬신", zh: ["昆仑芯"], en: "Kunlunxin", fix: ["곤륜심"] },
  { kind: "company", ko: "SMIC", zh: ["中芯国际", "中芯"], en: "SMIC", fix: ["중신궈지", "중심국제"] },
  { kind: "company", ko: "창신메모리", zh: ["长鑫科技", "长鑫"], en: "CXMT", fix: ["장신과기", "장신커지", "창신과기"] },
  { kind: "company", ko: "호라이즌 로보틱스", zh: ["地平线"], en: "Horizon Robotics", fix: ["지평선 로보틱스", "지핑셴"], hanSkip: ["地平线"] },
  { kind: "company", ko: "메이퇀", zh: ["美团"], en: "Meituan", fix: ["메이투안"], avoid: ["미단"] },
  { kind: "company", ko: "콰이쇼우", zh: ["快手"], en: "Kuaishou", fix: ["콰이서우"], avoid: ["쾌수"] },
  { kind: "company", ko: "징둥", zh: ["京东"], en: "JD.com", avoid: ["경동"] },
  { kind: "company", ko: "CATL", zh: ["宁德时代"], en: "CATL", fix: ["닝더스다이", "녕덕시대"] },
  { kind: "company", ko: "BYD", zh: ["比亚迪"], en: "BYD", fix: ["비야디"] },
  { kind: "company", ko: "샤오펑", zh: ["小鹏"], en: "XPeng", fix: ["소붕"] },
  { kind: "company", ko: "리오토", zh: ["理想汽车", "理想"], en: "Li Auto", fix: ["리샹 자동차", "리샹자동차", "이상자동차"], hanSkip: ["理想"] },
  { kind: "company", ko: "니오", zh: ["蔚来"], en: "NIO", avoid: ["웨이라이"], note: "'하오웨이라이(好未来)'와 겹쳐 자동으로 고치지 않는다" },
  { kind: "company", ko: "TAL에듀케이션", zh: ["好未来"], en: "TAL Education", fix: ["하오웨이라이"] },
  { kind: "company", ko: "넷이즈", zh: ["网易"], en: "NetEase", avoid: ["왕이"] },
  { kind: "company", ko: "샤오훙슈", zh: ["小红书"], en: "Xiaohongshu", fix: ["샤오홍슈", "소홍서"] },
  { kind: "company", ko: "바이두", zh: ["百度"], en: "Baidu", avoid: ["백도"] },
  { kind: "company", ko: "텐센트", zh: ["腾讯"], en: "Tencent", avoid: ["등신"] },
  { kind: "company", ko: "화웨이", zh: ["华为"], en: "Huawei", avoid: ["화위"] },
  { kind: "company", ko: "바이트댄스", zh: ["字节跳动", "字节"], en: "ByteDance", fix: ["자절도동", "쯔제탸오둥"] },
  { kind: "company", ko: "알리바바", zh: ["阿里巴巴", "阿里"], en: "Alibaba" },
  { kind: "company", ko: "샤오미", zh: ["小米"], en: "Xiaomi", avoid: ["소미"] },
  { kind: "company", ko: "앤트그룹", zh: ["蚂蚁集团"], en: "Ant Group" },
  // 영문 공식 이름 (한국 언론 표기가 정해지지 않음)
  { kind: "company", ko: "부스터 로보틱스", zh: ["加速进化"], en: "Booster Robotics", fix: ["가속진화"] },
  { kind: "company", ko: "LimX Dynamics", zh: ["逐际动力"], en: "LimX Dynamics", fix: ["즈지동력", "즈지 동력", "지지동력"] },
  { kind: "company", ko: "ShengShu", zh: ["生数科技"], en: "ShengShu", fix: ["생수과기", "셩수과기"] },
  { kind: "company", ko: "01.AI", zh: ["零一万物"], en: "01.AI", fix: ["영일만물", "링이완우"] },
  { kind: "company", ko: "Infinigence", zh: ["无问芯穹", "無問芯穹"], en: "Infinigence", fix: ["무문신궁", "우원신충"] },
  { kind: "company", ko: "Iluvatar CoreX", zh: ["天数智芯"], en: "Iluvatar CoreX", fix: ["톈수즈신", "텐셴수"] },
  { kind: "company", ko: "DataCanvas", zh: ["九章云极"], en: "DataCanvas", fix: ["구장윈지", "구장운극"] },
  { kind: "org", ko: "BAAI", zh: ["智源研究院", "北京智源"], en: "BAAI", fix: ["지위안연구원", "지위안 연구원"] },

  // 2026-11-06 후보 보고서에서 추가 (사용자 승인 "사전 초안 제안대로 진행")
  // 한국 언론 표기
  { kind: "company", ko: "엔플레임", zh: ["燧原科技", "燧原"], en: "Enflame", fix: ["수위안 테크놀로지", "수위안테크놀로지", "수위안커지", "수원커지", "쑤이위안커지"], note: "한국경제" },
  { kind: "company", ko: "노에틱스", zh: ["松延动力"], en: "Noetix Robotics", fix: ["송옌동력", "쏭옌동력", "송옌 동력"], note: "로봇신문·ZDNet" },
  { kind: "company", ko: "포패러다임", zh: ["范式智能", "第四范式", "范式集团"], en: "4Paradigm", fix: ["판식지능", "범식지능", "제4범식", "제사범식"], note: "第四范式 이 2025년 范式集团 으로 이름 바꿈 (ZDNet)" },
  { kind: "company", ko: "덱스포스", zh: ["跨维智能"], en: "DexForce", fix: ["크로스디멘션 인텔리전스", "크로스디멘션인텔리전스", "과유지능"], note: "로봇신문" },
  { kind: "company", ko: "키네틱스AI", zh: ["超维动力"], en: "Kinetix AI", fix: ["초유동력", "차오웨이동력"], note: "로봇신문" },
  { kind: "company", ko: "원더쉐어", zh: ["万兴科技"], en: "Wondershare", fix: ["완싱커지", "완싱과기", "만흥과기"], note: "회사 보도자료 표기 (외래어 표기법은 '원더셰어')" },
  { kind: "company", ko: "창안자동차", zh: ["长安汽车"], en: "Changan Automobile", fix: ["장안자동차", "장안 자동차", "창안 자동차"], note: "ZDNet. 长安 단독은 지명" },
  { kind: "company", ko: "라이트휠", zh: ["光轮智能"], en: "Lightwheel", fix: ["광륜지능", "광룬즈넝", "광륜 지능"], note: "로봇신문" },
  { kind: "company", ko: "모펫AI", zh: ["墨芯人工智能", "墨芯"], en: "Moffett AI", fix: ["모신인공지능", "모신 인공지능", "묵심인공지능"], note: "AI타임스. 모신과기(魔芯科技)는 다른 회사" },
  { kind: "company", ko: "스피릿AI", zh: ["千寻智能"], en: "Spirit AI", fix: ["천심지능", "치엔쉰즈넝", "첸쉰즈넝", "천쉰지능", "스피리트AI"], note: "서울경제 '스피릿AI', 로봇신문 '스피리트AI'" },
  { kind: "company", ko: "비타다이나믹스", zh: ["维他动力"], en: "Vita Dynamics", fix: ["웨이타동력", "유타동력"], note: "로봇신문" },
  { kind: "company", ko: "엑스스퀘어로봇", zh: ["自变量机器人", "自变量"], en: "X Square Robot", fix: ["자변량 로봇", "자변량로봇", "자변량"], hanSkip: ["自变量"], note: "로봇신문. 自变量 단독은 수학 용어(독립 변수)와 겹쳐 한자 사전에는 넣지 않는다" },
  { kind: "company", ko: "아스트리봇", zh: ["星尘智能"], en: "Astribot", fix: ["성진지능", "싱천지능", "애스트리봇"], note: "로봇신문 (2026-11-06 영문 → 한국어 표기)" },
  { kind: "company", ko: "아파리 테크놀로지", zh: ["千里科技"], en: "AFARI", fix: ["치리과기", "천리과기", "첸리커지", "치엔리커지"], note: "아주경제. 옛 力帆科技, 지리 계열" },
  // 한국 언론 표기 없음 → 영문 공식 이름
  { kind: "company", ko: "Approaching.AI", zh: ["趋境科技"], en: "Approaching.AI", fix: ["취징커지", "취징과기", "추경과기"] },
  { kind: "company", ko: "AIsphere", zh: ["爱诗科技"], en: "AIsphere", fix: ["아이스 테크놀로지", "아이시커지", "아이시 과기", "애시과기"], avoid: ["아이시"], note: "제품 PixVerse 는 그대로" },
  { kind: "company", ko: "MOSI", zh: ["模思智能"], en: "MOSI", fix: ["모사지능", "모쓰즈넝"] },
  { kind: "company", ko: "Evoken", zh: ["演语科技"], en: "Evoken", fix: ["연어과기", "옌위커지", "연어 과기"], note: "LiblibAI 운영사" },
  { kind: "company", ko: "Apex Intelligence", zh: ["超衍智能"], en: "Apex Intelligence", fix: ["초연지능", "차오옌즈넝"] },
  { kind: "company", ko: "Riemann Dynamics", zh: ["黎曼动力"], en: "Riemann Dynamics", fix: ["리만동력", "리만 동력"] },
  // 영문 이름 확인 안 됨 → 중국어 원음 한글 + 테크놀로지 (2026-11-06 결정)
  { kind: "company", ko: "다마오 테크놀로지", zh: ["达卯科技"], fix: ["달마오 과기", "달마오과기", "다마오 과기", "다마오과기", "달묘과기"] },
  { kind: "company", ko: "광판 테크놀로지", zh: ["光帆科技"], fix: ["광범과기", "광판과기", "광판커지", "광범 과기"], note: "'광범위 테크'(오역)는 '광범위'와 겹쳐 자동으로 고치지 않는다" },
  { kind: "company", ko: "우제 다이내믹스", zh: ["无界动力"], fix: ["무계동력", "우제동력", "무계 동력"] },
  { kind: "company", ko: "징숴 테크놀로지", zh: ["景烁科技"], fix: ["경삭과기", "징숴커지", "징숴과기"] },
  { kind: "org", ko: "SAIS", zh: ["上海科学智能研究院"], en: "Shanghai Academy of AI for Science", fix: ["상하이 과학지능연구원", "상하이과학지능연구원", "상하이 과학지능 연구원"] },
  { kind: "org", ko: "신랑커지", zh: ["新浪科技"], en: "Sina Tech", fix: ["신랑과기"], note: "매체 (뉴스1 표기)" },

  // ── 제품
  { kind: "product", ko: "어니봇", zh: ["文心一言"], en: "ERNIE Bot", fix: ["문심일언", "원신이옌"] },
  { kind: "product", ko: "어니", zh: ["文心大模型", "文心"], en: "ERNIE", fix: ["문심 대모델", "문심대모델"], avoid: ["문심"], hanSkip: ["文心"], note: "'문심 5.5' 처럼 숫자 앞의 문심은 ko-names.ts 가 고친다" },
  { kind: "product", ko: "큐원", zh: ["通义千问", "千问", "通义"], en: "Qwen", fix: ["통의천문", "퉁이첸원", "통이치엔원", "통이천문", "통이첸원", "통이치원", "퉁이치원", "치엔원", "큐웬", "큐엔", "퀜"], note: "2026-11-11 사용자 결정: Qwen = 큐원 (큐웬·큐엔·퀜 → 큐원)" },
  { kind: "product", ko: "클링", zh: ["可灵"], en: "Kling", fix: ["커링"] },
  { kind: "product", ko: "훈위안", zh: ["混元"], en: "Hunyuan", avoid: ["혼원"], note: "'혼원3' 처럼 숫자 앞은 ko-names.ts 가 고친다" },
  { kind: "product", ko: "더우바오", zh: ["豆包"], en: "Doubao", fix: ["두바오"], avoid: ["두포"] },
  { kind: "product", ko: "위안바오", zh: ["元宝"], en: "Yuanbao", avoid: ["원보"], hanSkip: ["元宝"] },
  { kind: "product", ko: "아폴로 고", zh: ["萝卜快跑"], en: "Apollo Go", fix: ["뤄보콰이파오", "나복쾌주"] },

  // ── AI 용어 (한국 업계 표준)
  {
    kind: "term", ko: "피지컬 AI", zh: ["具身智能", "物理AI", "物理人工智能"], en: "physical AI",
    fix: ["구현지능", "구현 지능", "구체지능", "구체 지능", "구신지능", "구현형 지능", "구현형 AI", "구현형 인공지능", "체화 지능", "체화지능", "체화 AI", "임바디드 AI", "엠바디드 AI", "임바디드 지능", "신체 지능", "물리 AI"],
    note: "具身机器人 '구현형 로봇' → '피지컬 AI 로봇' 은 ko-names.ts 규칙",
  },
  { kind: "term", ko: "AI 에이전트", zh: ["智能体"], en: "AI agent", fix: ["지능체", "스마트 에이전트"], note: "'에이전트' 단독은 그대로 둔다" },
  { kind: "term", ko: "컴퓨팅 파워", zh: ["算力"], en: "computing power", avoid: ["산력"], note: "'연산 능력'·'연산력'은 허용" },
  { kind: "term", ko: "월드 모델", zh: ["世界模型"], en: "world model", fix: ["세계 모델", "세계모델"] },
  { kind: "term", ko: "대형 모델", zh: ["大模型"], en: "large model", fix: ["대모델", "대모형"], note: "大语言模型 은 '거대언어모델(LLM)'" },
  { kind: "term", ko: "토큰", zh: ["词元"], en: "token", avoid: ["사원"] },
  { kind: "term", ko: "온디바이스", zh: ["端侧"], en: "on-device", fix: ["단말 측", "단측"] },
  { kind: "term", ko: "슈퍼노드", zh: ["超节点"], en: "supernode", fix: ["초노드", "초 노드", "슈퍼 노드"] },
  { kind: "term", ko: "휴머노이드 로봇", zh: ["人形机器人"], en: "humanoid robot", fix: ["인형 로봇", "인형로봇"], note: "'인간형 로봇'은 허용" },
  { kind: "term", ko: "로봇 손", zh: ["灵巧手"], en: "dexterous hand", fix: ["영교수", "민첩한 손"] },
  { kind: "term", ko: "기반 모델", zh: ["基座模型", "基础模型"], en: "foundation model", fix: ["기좌 모델"], note: "'파운데이션 모델'도 허용 (2026-11-06 결정: 기반 모델 유지)" },
  { kind: "term", ko: "데이터 플라이휠", zh: ["数据飞轮"], en: "data flywheel", fix: ["데이터 바퀴"] },
  { kind: "term", ko: "오픈 웨이트", zh: ["开放权重"], en: "open weights", fix: ["개방 가중치"] },
  { kind: "term", ko: "오픈소스", zh: ["开源"], en: "open source", avoid: ["개원"] },
  { kind: "term", ko: "사후 학습", zh: ["后训练"], en: "post-training", fix: ["후훈련"] },
  { kind: "term", ko: "해외 진출", zh: ["出海"], en: "going global", fix: ["출해"] },
  { kind: "term", ko: "상용화", zh: ["落地"], en: "deployment", avoid: ["착지", "낙지"] },
  { kind: "term", ko: "과당 경쟁", zh: ["内卷"], en: "involution", fix: ["내권"] },
  { kind: "term", ko: "커촹반", zh: ["科创板"], en: "STAR Market", fix: ["과창판", "과학기술혁신판"] },
  { kind: "term", ko: "AI 데이터센터", zh: ["智算中心"], en: "AI computing center", fix: ["지산 센터", "지산센터", "지능 컴퓨팅 센터"] },
  { kind: "term", ko: "GPU 1만 장 클러스터", zh: ["万卡集群"], en: "10,000-GPU cluster", fix: ["만 카드 클러스터", "만카드 클러스터", "만카 클러스터"] },
  { kind: "term", ko: "컨텍스트", zh: ["上下文"], en: "context", fix: ["상하문"] },
  { kind: "term", ko: "사고 사슬(CoT)", zh: ["思维链"], en: "chain of thought", fix: ["사유 체인", "사유 사슬"] },
  { kind: "term", ko: "전문가 혼합(MoE)", zh: ["混合专家模型"], en: "mixture of experts", fix: ["혼합 전문가 모델"] },
  { kind: "term", ko: "멀티모달", zh: ["多模态"], en: "multimodal", fix: ["다모태"] },
  { kind: "term", ko: "파인튜닝", zh: ["微调"], en: "fine-tuning", avoid: ["미조"] },
  { kind: "term", ko: "네이티브", zh: ["原生"], en: "native", fix: ["원생 멀티모달", "원생 모델"] },
  { kind: "term", ko: "숏드라마", zh: ["短剧"], en: "short drama", avoid: ["단극"], note: "'단극'은 '단극 체제'와 겹친다" },
  { kind: "term", ko: "스마트 콕핏", zh: ["智能座舱", "座舱"], en: "smart cockpit", fix: ["스마트 좌석실", "좌창"] },
  { kind: "term", ko: "스마트 드라이빙", zh: ["智驾", "智能驾驶"], en: "intelligent driving", fix: ["지가 시스템"] },
  { kind: "term", ko: "컴퓨팅·전력 연계", zh: ["算电协同"], en: "compute-power coordination", fix: ["산전 협동", "산전 협력"] },
  { kind: "term", ko: "신질생산력", zh: ["新质生产力"], en: "new quality productive forces" },
  { kind: "term", ko: "자기 진화", zh: ["自进化"], en: "self-evolution", fix: ["자진화"], note: "'자가 진화' 허용" },
  { kind: "term", ko: "재귀적 자기 개선", zh: ["递归自我改进"], en: "recursive self-improvement" },
  { kind: "term", ko: "해자", zh: ["护城河"], en: "moat" },
  { kind: "term", ko: "유니콘", zh: ["独角兽"], en: "unicorn", fix: ["독각수"] },
  { kind: "term", ko: "AI for Science", zh: ["科学智能"], en: "AI for Science", avoid: ["과학지능"], note: "'과학지능'은 다른 뜻과 겹쳐 자동으로 고치지 않는다" },
];

/** 중국어 표기 → 항목 (쉬운 AI 설명의 용어 이름, 번역 지시용) */
export function glossByZh(zh: string): GlossEntry | undefined {
  const t = zh.trim();
  return KO_GLOSSARY.find((e) => e.zh.includes(t));
}

/** 원문(중국어)에 나오는 항목만 — 번역 지시에 그 기사 몫만 넣는다 */
export function glossEntriesInZh(text: string): GlossEntry[] {
  return KO_GLOSSARY.filter((e) => e.zh.some((z) => text.includes(z)));
}

// ───────────────────────── 번역 지시에 넣을 사전 구간 (n8n 번역·다듬기·인사이트, scripts/insight-fix.ts)

/** 모델에게 줄 압축 사전: [중국어 표기들, 한국어, 영문, 쓰지 말 것(fix+avoid)] */
export const GLOSSARY_COMPACT: [string[], string, string, string[]][] = KO_GLOSSARY.map((e) => [e.zh, e.ko, e.en ?? "", [...(e.fix ?? []), ...(e.avoid ?? [])]]);

/**
 * 원문에 나온 항목만 골라 지시 한 덩어리로 (없으면 ""). n8n 식 안에서는 GLOSSARY_PICK_JS 가 같은 일을 한다 —
 * tests/text/ko-glossary.test.ts 가 두 결과가 같은지 확인한다 (Gate 2).
 */
export function glossaryPromptBlock(text: string, max = 25): string {
  const hit = GLOSSARY_COMPACT.filter((g) => g[0].some((z) => text.includes(z))).slice(0, max);
  if (!hit.length) return "";
  return (
    "\n\nKOREAN NAME/TERM GLOSSARY for this article. In Korean text write exactly the Korean form (English form in English text); never write the forms after ✗:\n" +
    hit.map((g) => `- ${g[0].join("/")} = ${g[1]}${g[2] && g[2] !== g[1] ? ` (${g[2]})` : ""}${g[3].length ? ` ✗ ${g[3].join(", ")}` : ""}`).join("\n")
  );
}

/** n8n 식 안에서 쓰는 같은 함수 (식 안에 '}}' 가 생기지 않게 중괄호를 붙여 쓰지 않는다). 인자: (G = GLOSSARY_COMPACT, text, max) */
export const GLOSSARY_PICK_JS = `function (G, text, max) {
  const hit = G.filter(function (g) { return g[0].some(function (z) { return text.indexOf(z) >= 0; }); }).slice(0, max || 25);
  if (!hit.length) return '';
  return '\\n\\nKOREAN NAME/TERM GLOSSARY for this article. In Korean text write exactly the Korean form (English form in English text); never write the forms after \\u2717:\\n' +
    hit.map(function (g) { return '- ' + g[0].join('/') + ' = ' + g[1] + (g[2] && g[2] !== g[1] ? ' (' + g[2] + ')' : '') + (g[3].length ? ' \\u2717 ' + g[3].join(', ') : ''); }).join('\\n');
}`;

/** n8n 식 조각: textExpr(예: "$json.title_cn + ' ' + ($json.content_cn || '')")에 나온 항목의 지시 구간 */
export function glossaryN8nExpr(textExpr: string): string {
  const expr = `((${GLOSSARY_PICK_JS})(${JSON.stringify(GLOSSARY_COMPACT)}, String(${textExpr})))`;
  if (expr.includes("}}")) throw new Error("n8n 식 안에서 }} 는 쓸 수 없다");
  return expr;
}
