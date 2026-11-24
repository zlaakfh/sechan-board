#!/bin/sh
# 세찬 보드(Supabase board_state) 읽기/쓰기 도우미
#   ./scripts/board.sh get            → 현재 저장된 data + updated_at (JSON)
#   ./scripts/board.sh data           → data만 (JSON)
#   ./scripts/board.sh put FILE.json  → FILE.json(data 객체)을 그대로 서버에 저장
#
# 접속 정보는 저장소에 올리지 않는 sechan-board/.supabase.json 에서 읽습니다.
set -e
DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
CFG="$DIR/.supabase.json"
[ -f "$CFG" ] || { echo "{\"error\":\"missing .supabase.json\"}"; exit 1; }

URL=$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['url'])" "$CFG")
KEY=$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['publishable_key'])" "$CFG")

case "$1" in
  get)
    curl -s "$URL/rest/v1/board_state?id=eq.main&select=data,updated_at" \
      -H "apikey: $KEY" -H "Authorization: Bearer $KEY"
    ;;
  data)
    curl -s "$URL/rest/v1/board_state?id=eq.main&select=data" \
      -H "apikey: $KEY" -H "Authorization: Bearer $KEY" \
      | python3 -c "import json,sys; print(json.dumps(json.load(sys.stdin)[0]['data'], ensure_ascii=False, indent=2))"
    ;;
  put)
    SRC="$2"
    [ -f "$SRC" ] || { echo "{\"error\":\"usage: board.sh put FILE.json\"}"; exit 1; }
    BODY=$(python3 - "$SRC" <<'PY'
import json, sys, datetime
data = json.load(open(sys.argv[1]))
if not isinstance(data, dict) or not isinstance(data.get('categories'), list):
    raise SystemExit('{"error":"data must be an object with categories[]"}')
now = datetime.datetime.now(datetime.timezone.utc).isoformat().replace('+00:00', 'Z')
data['savedAt'] = now
print(json.dumps({"id": "main", "data": data, "updated_at": now}, ensure_ascii=False))
PY
)
    curl -s -o /dev/null -w '{"status":%{http_code}}\n' -X POST "$URL/rest/v1/board_state" \
      -H "apikey: $KEY" -H "Authorization: Bearer $KEY" \
      -H "Content-Type: application/json" \
      -H "Prefer: resolution=merge-duplicates,return=minimal" \
      --data-binary "$BODY"
    ;;
  *)
    echo "usage: board.sh get | data | put FILE.json"
    exit 1
    ;;
esac
