#!/usr/bin/env bash
# ===== Studio Route134 — 本番公開 =====
#
# 工事中の案内ページを外し、サイト本体を sr134.com で公開する。
#
#   bash deploy/publish.sh --check    いまの状態を確認するだけ
#   bash deploy/publish.sh            公開する
#   bash deploy/publish.sh --revert   工事中の状態へ戻す
#
# 公開前の状態は public_html/_maintenance_backup/ に退避するため、
# いつでも元へ戻せる。メールとDNSには一切触れない。
set -euo pipefail

SERVER_ID="${SERVER_ID:-xs936545}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/xserver_sr134}"
SSH_PORT=10022
REMOTE="${SERVER_ID}@${SERVER_ID}.xsrv.jp"
DOC="/home/${SERVER_ID}/sr134.com/public_html"
LOCAL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SSH="ssh -i ${SSH_KEY} -p ${SSH_PORT} -o BatchMode=yes"

mode="${1:-}"

status() {
  echo "=== いまの状態 ==="
  curl -s -o /dev/null -w "  https://sr134.com/            %{http_code}\n" --max-time 20 https://sr134.com/
  curl -s -o /dev/null -w "  https://sr134.com/shop.html   %{http_code}\n" --max-time 20 https://sr134.com/shop.html
  curl -s --max-time 20 https://sr134.com/ | grep -qi "under construction" \
    && echo "  → 工事中の案内を表示しています" \
    || echo "  → サイト本体を表示しています"
}

if [ "$mode" = "--check" ]; then
  status
  exit 0
fi

if [ "$mode" = "--revert" ]; then
  echo "工事中の状態へ戻します"
  $SSH "$REMOTE" "cd '${DOC}' && test -d _maintenance_backup && cp _maintenance_backup/.htaccess .htaccess && cp _maintenance_backup/index.html index.html && echo 戻しました"
  status
  exit 0
fi

echo "=== 公開前の状態を退避 ==="
$SSH "$REMOTE" "cd '${DOC}' && mkdir -p _maintenance_backup && cp -f .htaccess index.html _maintenance_backup/ 2>/dev/null; echo 退避しました"

echo "=== サイト本体を転送 ==="
cd "$LOCAL_DIR"
tar czf - \
  --exclude='.git' --exclude='.github' --exclude='deploy' --exclude='tools' \
  --exclude='maintenance' --exclude='photos/_original' --exclude='*.md' \
  . | $SSH "$REMOTE" "cd '${DOC}' && tar xzf - && echo 転送完了"

echo "=== 本番用の設定を適用 ==="
scp -i "$SSH_KEY" -P "$SSH_PORT" -o BatchMode=yes .htaccess "$REMOTE:${DOC}/.htaccess"

echo "=== 確認 ==="
sleep 2
for p in "" "shop.html" "stores.html" "brand.html" "news.html" "robots.txt" "sitemap.xml"; do
  curl -s -o /dev/null -w "  /$p  %{http_code}\n" --max-time 25 "https://sr134.com/$p"
done
status
echo
echo "元へ戻す場合は bash deploy/publish.sh --revert"
