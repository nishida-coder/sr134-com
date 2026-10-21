#!/usr/bin/env bash
# ===== Studio Route134 — 確認用プレビューの配信 =====
# 配信先は SR134 自身のサーバー。libun.co.jp は使わない。
#
#   bash deploy/preview-deploy.sh
set -euo pipefail

SERVER_ID="${SERVER_ID:-xs936545}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/xserver_sr134}"
SSH_PORT=10022
REMOTE="${SERVER_ID}@${SERVER_ID}.xsrv.jp"
REMOTE_DIR="/home/${SERVER_ID}/sr134.com/public_html/preview"
LOCAL_DIR="$(cd "$(dirname "$0")/.." && pwd)"

cd "$LOCAL_DIR"
tar czf - \
  --exclude='.git' --exclude='.github' --exclude='deploy' --exclude='tools' \
  --exclude='maintenance' --exclude='photos/_original' --exclude='*.md' \
  . | ssh -i "$SSH_KEY" -p "$SSH_PORT" -o BatchMode=yes "$REMOTE" \
      "mkdir -p '${REMOTE_DIR}' && cd '${REMOTE_DIR}' && tar xzf - && echo 転送完了"

echo "確認 https://sr134.com/preview/"
