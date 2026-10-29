#!/bin/bash
# Стенд читалки: восстановление окружения после сброса песочницы.
#
#   bash koma/setup.sh          # зависимости + swap + dev-сервер на 5174
#
# Что важно: память. ONNX WASM на настоящей странице манги просит больше
# гигабайта, и без swap кадр падает с «Target crashed» (проверено 29.10).
set -u
HERE="$(cd "$(dirname "$0")/.." && pwd)"

echo "── 1. системные библиотеки для Chromium"
sudo -n apt-get install -y -q libnspr4 libnss3 libasound2t64 libgbm1 libxkbcommon0 \
  libatk1.0-0 libatk-bridge2.0-0 libatspi2.0-0 libxdamage1 libxcomposite1 libxrandr2 \
  libcups2 libxfixes3 libpango-1.0-0 libcairo2 libdrm2 >/dev/null 2>&1 || true

echo "── 2. playwright"
python3 -c "import playwright" 2>/dev/null || pip install -q playwright
python3 -m playwright install chromium >/dev/null 2>&1 || true

echo "── 3. swap 2 ГБ (swapon --show в песочнице нет, смотрим /proc/swaps)"
if ! grep -q swapfile /proc/swaps; then
  sudo -n bash -c 'test -f /swapfile || (fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null); swapon /swapfile 2>/dev/null; true'
fi
grep -q swapfile /proc/swaps && echo "   swap есть" || echo "   swap НЕ поднялся (прогон может упасть по памяти)"

echo "── 4. зависимости студии"
cd "$HERE" && [ -d node_modules ] || npm install --no-audit --no-fund

echo "── 5. dev-сервер на 5174 (KOMA-режим: http://localhost:5174/?koma=1)"
if ! curl -s -o /dev/null http://localhost:5174/; then
  setsid npx vite --port 5174 --strictPort --host 0.0.0.0 > /tmp/vite-koma.log 2>&1 < /dev/null &
  sleep 12
fi
curl -s -o /dev/null -w "   5174: %{http_code}\n" http://localhost:5174/

echo "── 6. прогоны"
echo "   python3 koma/live.py --apk /home/user/koma-reader-v1.9.42.apk \\"
echo "       --page /home/user/kw9/koma-web.html --image /home/user/koma-lab/dense-a.jpg"
