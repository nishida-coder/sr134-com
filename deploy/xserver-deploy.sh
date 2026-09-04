#!/usr/bin/env bash
# ===== Studio Route134 — XServer デプロイ =====
# 使い方
#   1. 下の SERVER_ID を、XServerサーバーパネルの「サーバーID」に書き換える
#   2. bash deploy/xserver-deploy.sh
#
# 前提
#   - XServerサーバーパネルで SSH設定を「ON」にし、公開鍵 ~/.ssh/xserver_sr134.pub を登録済みであること
#   - sr134.com が「ドメイン設定」に追加済みであること

set -euo pipefail

SERVER_ID="${SERVER_ID:-CHANGE_ME}"          # 例 xagm のような短い英数字。契約IDではない
DOMAIN="sr134.com"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/xserver_sr134}"
SSH_PORT=10022
REMOTE="${SERVER_ID}@${SERVER_ID}.xsrv.jp"
REMOTE_DIR="/home/${SERVER_ID}/${DOMAIN}/public_html/"
LOCAL_DIR="$(cd "$(dirname "$0")/.." && pwd)/"

if [ "$SERVER_ID" = "CHANGE_ME" ]; then
  echo "ERROR: SERVER_ID が未設定です。XServerサーバーパネルの「サーバーID」を指定してください。" >&2
  echo "  例: SERVER_ID=xxxx bash deploy/xserver-deploy.sh" >&2
  exit 1
fi

echo "=== 接続確認 ==="
ssh -i "$SSH_KEY" -p "$SSH_PORT" -o BatchMode=yes -o ConnectTimeout=15 "$REMOTE" "echo OK; pwd"

echo
echo "=== 転送先の確認 ==="
ssh -i "$SSH_KEY" -p "$SSH_PORT" "$REMOTE" "test -d '${REMOTE_DIR}' && echo '公開ディレクトリ OK: ${REMOTE_DIR}'"

echo
echo "=== 同期（--delete あり。公開ディレクトリを本リポジトリの内容に一致させる）==="
rsync -avz --delete \
  -e "ssh -i ${SSH_KEY} -p ${SSH_PORT}" \
  --exclude '.git/' \
  --exclude '.github/' \
  --exclude 'deploy/' \
  --exclude 'CLAUDE_TASKS.md' \
  --exclude '.DS_Store' \
  "$LOCAL_DIR" "${REMOTE}:${REMOTE_DIR}"

echo
echo "=== 完了 ==="
echo "確認 URL : https://${SERVER_ID}.xsrv.jp/  （DNS切替前の表示確認用）"
echo "切替後   : https://${DOMAIN}/"
echo
echo "注意 : .htaccess の HTTPS 強制は、XServer の無料独自SSL を発行したあとで"
echo "       コメントを外すこと。発行前に有効化すると全ページが表示できなくなる。"
