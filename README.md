# 세찬 × 클피 워크스페이스

개인 프로젝트 관리용 정적 웹 보드입니다. 빌드 없이 `index.html` 하나로 뜨는 순수 HTML/CSS/JS 앱이고, GitHub Pages로 배포됩니다.

## 구성

- **홈** — 다가오는 마감(D-day), 필터(전체·긴급·진행중·대기·보관·완료), 카테고리 카드(진행률·다음 마감)
- **상세** — ① 보고(표·링크) ② 진행상황 ③ 할 일(진행률 자동 계산) ④ 체크리스트 ⑤ 메모, 하단 입력창에서 바로 추가
- **잠금** — 4자리 PIN 화면(기본값은 앱 최초 실행 시 설정), 설정에서 변경
- **저장** — 체크·메모·카테고리 수정은 Supabase 서버에 저장(폰·PC 동기화), 오프라인 시 브라우저 localStorage 폴백

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
