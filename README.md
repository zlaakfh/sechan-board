# 세찬 × 클피 워크스페이스

개인 프로젝트 관리용 정적 웹 보드입니다. 빌드 없이 `index.html` 하나로 뜨는 순수 HTML/CSS/JS 앱이고, GitHub Pages로 배포됩니다.

## 구성

- **홈** — 다가오는 마감(D-day), 필터(전체·긴급·진행중·대기·보관·완료), 카테고리 카드(진행률·다음 마감)
- **상세** — ① 보고(표·링크) ② 진행상황 ③ 할 일(진행률 자동 계산) ④ 체크리스트 ⑤ 메모(대화형 말풍선 — 세찬님 오른쪽·클피 왼쪽, 날짜 구분선·링크 자동), 하단 입력창에서 바로 추가
  - `📈 주식 · 월급 투자` — 종목별 **주가·수익률 추이 그래프**(SVG, 종목 탭·평단 점선·툴팁)
  - `📰 뉴스 · 브리핑 아카이브` — 진행상황을 **날짜별 브리핑 아카이브**로 묶어서 표시(긴급속보 강조)
  - `🇦🇺 IELTS 스피킹` — **오답노트** 섹션(하부 카테고리 `✍️ 틀린 문장` · `📖 단어장` 탭, 복습 완료 체크)
  - `💸 지출 · 가계부` — **가계부 대시보드**(요약 카드 4칸 · 월별 지출 막대그래프와 예산 점선 · 카테고리별 가로 막대 · 성격별 3분류)
- **잠금** — 4자리 PIN 화면(기본값은 앱 최초 실행 시 설정), 설정에서 변경
- **저장** — 체크·메모·카테고리 수정은 Supabase 서버에 저장(폰·PC 동기화), 오프라인 시 브라우저 localStorage 폴백

### 클피가 매일 추가하는 데이터 형식

`board_state`의 `data` 안에 그대로 넣으면 화면이 알아서 이어 그립니다.

```jsonc
// 1) 종목별 시세 — data.stockCharts[키].points 끝에 하루치를 추가
"stockCharts": {
  "nvidia": {
    "label": "엔비디아",
    "sub": "NVDA · 토스 원화 환산",
    "unit": "원",
    "avgPrice": 176993,            // 평단(모르면 null → 점선·수익률 탭 숨김)
    "points": [
      { "date": "2026-11-24", "price": 209315 }   // date는 YYYY-MM-DD, 같은 날짜는 마지막 값 사용
    ]
  }
}
```

- 기본 키: `nvidia` `tesla` `tiger_sp500` `kodex_ndx100` `tiger_200weekly` `krx_gold` `sgov` `usdkrw` (키를 새로 만들면 탭도 새로 생깁니다)
- 표시 순서는 각 종목의 `order`(작을수록 앞)이고, `unit`은 `원`·`달러`처럼 그대로 화면에 붙습니다.
- `avgPrice`를 채우면 평단 점선과 `수익률` 탭이 함께 열립니다.

```jsonc
// 2) 브리핑 아카이브 — news 카테고리의 progress 끝에 한 건 추가
{
  "date": "2026-11-25",   // YYYY-MM-DD (화면에서 날짜별로 묶임)
  "time": "08:30",         // HH:MM (같은 날 안에서 최신이 위로)
  "tag": "주식 브리핑",     // 아침 뉴스 / 주식 브리핑 / 긴급속보 …(긴급속보는 빨간 강조)
  "text": "한국장 마감 — 코스피 …"   // 여러 줄은 \n
}
```

`stockCharts`와 `news`의 `progress`는 `./scripts/board.sh`로 읽어 고친 뒤 `put`하면 됩니다(기존 체크·메모는 그대로 유지).

```jsonc
// 3) IELTS 오답노트 — ielts 카테고리의 wrongNotes 에 문장/단어를 쌓는다
"wrongNotes": {
  "sentences": [   // ✍️ 틀린 문장 탭
    {
      "id": "s3",                 // 고유 id (없던 id면 새로 추가, 같은 id면 건드리지 않음)
      "date": "2026-11-25",       // YYYY-MM-DD
      "wrong": "I live in apartment.",                  // 내가 말한 문장
      "correct": "I live in an apartment.",             // 자연스러운 교정 문장
      "tip": "단수 가산명사 앞에는 부정관사 an",           // 이유·포인트
      "done": false               // 복습 완료 체크(화면에서 토글)
    }
  ],
  "words": [       // 📖 단어장 탭
    {
      "id": "w2",
      "date": "2026-11-25",
      "word": "central heating",
      "meaning": "중앙 난방",
      "example": "My apartment has really strong central heating.",
      "done": false
    }
  ]
}
```

`id`는 날짜+번호(예: `s3`, `w2`)로 올리면 됩니다. 이미 있는 `id`는 다시 넣지 않으므로, 연습이 끝날 때마다 새 항목만 `sentences`·`words` 배열 끝에 더하고 `put`하면 화면에 그대로 쌓입니다.

```jsonc
// 4) 가계부 대시보드 — spending 카테고리의 dashboard (매주 일요일 갱신)
"dashboard": {
  "updatedAt": "2026-11-25",           // 갱신 날짜
  "period": "2026년 11월 (11/1~24)",    // 섹션 오른쪽 위 문구
  "cards": [                            // 핵심 요약 카드 (모바일 2x2 · PC 4칸)
    { "label": "11월 총 실지출", "value": 2897852, "note": "중복 25.9만 제거 · 쿠팡 14.5만 반영" },
    { "label": "평소 생활비", "value": 1690000, "display": "약 169만 원", "note": "일회성 제외" },
    { "label": "월 생활비 목표", "value": 1470000, "display": "147만 원", "delta": "+22만 초과", "tone": "warn" },
    { "label": "AI 정기구독 실결제", "value": 192854, "tone": "sub" }
  ],
  "budget": { "value": 1470000, "label": "월 생활비 예산" },  // 월별 그래프의 빨간 점선
  "months": [ { "month": "2026-11", "value": 2897852 } ],    // 월별 막대 (달이 늘면 배열에 추가)
  "categories": [ { "emoji": "👕", "label": "패션 · 쇼핑", "value": 1000110 } ],  // 비중 %는 자동 계산
  "groups": [                            // 지출 성격별 3분류
    { "title": "고정 · 구독", "hint": "19.3만+", "total": 192854, "tone": "fixed",
      "items": [ { "label": "Claude Max", "value": 133873 },
                 { "label": "SKT · 유튜브 프리미엄", "note": "확인 중" } ] }
  ],
  "monthNote": "…", "categoryNote": "…", "groupNote": "…", "freshNote": "…"  // 섹션 아래 작은 설명
}
```

- 금액은 모두 **원 단위**로 넣으면 만 원 표기·콤마·비중은 화면이 계산합니다(`display`를 넣으면 그 문구를 그대로 씁니다).
- `tone` — 카드: `base`(기본) · `warn`(노랑 강조) · `sub`(보라 강조) / 3분류: `fixed` · `daily` · `once`(왼쪽 색선).
- `dashboard`만 바꿔 `put`하면 나머지 카테고리·체크·메모는 그대로 남습니다.

```jsonc
// 5) 메모(대화형) — 카테고리의 memos 끝에 한 건 추가
{
  "id": "m1a2b3c",                       // 고유 id(없어도 표시됨 · 삭제는 화면에서)
  "text": "환율 1,400원 넘으면 SGOV 대신 CMA",   // http(s)·www 주소는 자동 링크
  "at": "2026-11-27T13:39:00+09:00",     // ISO 시간 — 채팅처럼 시간순으로 쌓임
  "who": "keulpi"                         // sechan(오른쪽 보라) / keulpi(왼쪽 시안)
}
```

- `who`가 없는 예전 메모는 **세찬님 글**로 표시됩니다(데이터 그대로 유지).
- 화면 입력창에서 남긴 메모는 `{ id, text, at, who: "sechan" }`으로 저장되고, 클피가 답을 달 때는 `who: "keulpi"`로 같은 배열 끝에 넣으면 왼쪽 말풍선으로 붙습니다.
- 20개를 넘으면 위쪽에 `이전 메모 N개 더 보기`가 붙고, 내 메모에는 마우스를 올리면 `삭제`가 나타납니다.

## 파일

| 파일 | 역할 |
| --- | --- |
| `index.html` | 화면 구조(잠금·홈·상세·모달) |
| `style.css` | 모바일 퍼스트 스타일(라이트/다크) |
| `data.js` | 기본 카테고리·마감 데이터 |
| `config.js` | Supabase 프로젝트 URL·anon key (공개 가능한 값) |
| `scripts/board.sh` | 클피가 서버 상태를 읽고 쓰는 도우미 |
| `app.js` | 렌더링, 라우팅(#/c/&lt;id&gt;), 저장, PIN, 서버 동기화 |

## 저장 (동기화)

- **서버 저장** — Supabase 무료 프로젝트의 `board_state` 테이블(행 1개, `data` jsonb)에 저장합니다. 폰·PC에서 같은 주소로 열면 같은 내용을 보고, 수정하면 0.4초 뒤 자동 저장됩니다.
- **표시** — 상단 배지가 `동기화 중…` → `동기화됨` 으로 바뀝니다. 네트워크가 끊기면 `오프라인 저장` 이 되고 이 브라우저(localStorage)에 남아 있다가, 연결되면 다시 서버로 올라갑니다.
- **다른 기기 반영** — 12초마다(그리고 화면을 다시 볼 때) 서버를 확인해 바뀐 내용을 가져옵니다.
- **설정 파일** — `config.js`의 `window.SUPABASE_CONFIG`(프로젝트 URL·anon key). anon key는 공개되어도 되는 키이고, `service_role` 키는 어디에도 넣지 않습니다.

### 클피가 직접 읽고 쓰기 (REST)

```bash
# 읽기
curl -s "$URL/rest/v1/board_state?id=eq.main&select=data,updated_at" \
  -H "apikey: $KEY" -H "Authorization: Bearer $KEY"

# 쓰기(행 통째로 교체)
curl -s -X POST "$URL/rest/v1/board_state" \
  -H "apikey: $KEY" -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" -H "Prefer: resolution=merge-duplicates,return=minimal" \
  -d '{"id":"main","data":{...},"updated_at":"2026-01-01T00:00:00Z"}'
```

`$URL`·`$KEY` 값은 저장소에 올리지 않는 로컬 파일 `sechan-board/.supabase.json`에 있습니다. 위 curl을 매번 쓰지 않으려면 도우미 스크립트를 쓰세요.

```bash
./scripts/board.sh get            # 현재 상태(data + updated_at)
./scripts/board.sh data           # data만 보기 좋게
./scripts/board.sh put FILE.json  # FILE.json(data 객체)을 서버에 저장
```

## 메모

- 저장소가 공개이므로 계좌번호·전화번호·상세 주소·생년월일 같은 민감정보는 넣지 않습니다.
- PIN은 화면 잠금용이며 강한 보안 수단이 아닙니다.
- anon key가 공개되므로 DB 접근 자체는 PIN으로 막히지 않습니다(화면 잠금만). 민감한 내용은 보드에 넣지 마세요.
