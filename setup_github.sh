#!/bin/bash
# Create GitHub repo and push
GITHUB_TOKEN="$1"

# Create repo
curl -s -X POST \
  -H "Authorization: token $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github.v3+json" \
  https://api.github.com/user/repos \
  -d '{"name":"hermes-bot","private":false,"description":"AI trading bot for Polymarket & Binance"}'

# Set remote and push
cd /home/stephenliu/hermes-bot
git remote add origin "https://love6598878593-design:$GITHUB_TOKEN@github.com/love6598878593-design/hermes-bot.git"
git push -u origin main
