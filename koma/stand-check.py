#!/usr/bin/env python3
"""Проверка самого стенда (быстро, без манги и моделей): годен ли эмулятор.

Тяжёлый прогон `koma/live.py` отвечает на вопрос «как читает читалка». Этот
скрипт отвечает на предыдущий: «а стенд-то работает?». Если он падает, падения
live.py ничего не говорят о читалке.

Проверяется:
  1. KOMA-режим поднимается и в кадре появляется панель стенда;
  2. плагин из `koma/plugins/` применён (id и правила видны странице);
  3. в кадре есть все четыре моста Android-оболочки;
  4. голос: `KomaSpeech.speak` даёт события start/end и попадает в журнал;
  5. панель: `KomaUi.show` обновляет панель на экране (текст, номер реплики);
  6. команды панели доходят до страницы (`__komaCmd`);
  7. `__komaReport()` отдаёт JSON со всеми полями;
  8. сверка с эталоном на экране считает попадания (data-koma-hits).

  python3 koma/stand-check.py
  python3 koma/stand-check.py --apk /home/user/koma-reader-v1.9.42.apk
"""
import argparse
import asyncio
import json
import os
import sys

from playwright.async_api import async_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)
from probe import make_probe_apk
STUDIO = os.environ.get('STUDIO_URL', 'http://localhost:5174/?koma=1')
ok_all = True


def ok(cond, msg):
    global ok_all
    print(('PASS ' if cond else 'FAIL ') + msg)
    if not cond:
        ok_all = False


async def run(args):
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'])
        pg = await b.new_page(viewport={'width': 1560, 'height': 1060})
        errors = []
        pg.on('pageerror', lambda e: errors.append(str(e)[:160]))
        await pg.goto(STUDIO, wait_until='networkidle', timeout=120000)
        await pg.wait_for_timeout(2500)

        ok(await pg.locator('[data-koma-panel]').count() == 1, 'панель стенда на экране')

        # Настоящий АПК кладёт страницу в assets/koma-web.html, а эмулятор
        # показывает приложение только с assets/webapp/index.html. Поэтому
        # ставим пробный АПК: копия настоящего + наша страница как webapp.
        probe = os.path.join('/tmp', 'koma-stand-probe.apk')
        apk_size, page_size = make_probe_apk(args.apk, args.page, probe)
        print(f'пробный АПК: {apk_size} Б (страница {page_size} Б)')
        await pg.locator('input[type=file][accept=".apk"]').set_input_files(probe)
        # Кадр появляется не сразу: сначала разбор АПК, потом сборка страницы с
        # мостами. Ждём именно момент, когда в кадре есть наши мосты, — иначе
        # проверка ловит пустой about:blank и валится зря (29.10).
        frames = []
        for _ in range(60):
            await pg.wait_for_timeout(500)
            frames = [f for f in pg.frames if f != pg.main_frame]
            if not frames:
                continue
            try:
                if await frames[0].evaluate("() => typeof window.KomaSpeech === 'object'"):
                    break
            except Exception:
                continue
        ok(bool(frames), 'приложение поднялось в эмуляторе')
        if not frames:
            await b.close()
            return
        fr = frames[0]
        await pg.wait_for_timeout(500)

        plugin = await fr.evaluate("() => window.__komaPlugin ? window.__komaPlugin.id : ''")
        ok(plugin == 'forge-emulator', 'плагин стенда применён: ' + (plugin or 'нет'))
        rules = await fr.evaluate("() => JSON.stringify((window.__komaPlugin||{}).rules || {})")
        ok('pipeline' in rules, 'правила плагина видны странице: ' + rules[:60])

        bridges = await fr.evaluate("""() => ['KomaSpeech','KomaUi','KomaApp','KomaPlugins']
            .map(n => n + ':' + (typeof window[n]))""")
        ok(all(s.endswith(':object') for s in bridges), 'мосты в кадре: ' + ' · '.join(bridges))

        # ── голос через мост ────────────────────────────────────────────────
        await fr.evaluate("() => { window.__komaTtsReset(); window.__komaSpokenReset(); }")
        await fr.evaluate("""() => new Promise(done => {
            window.__komaSpeechEvent = (id, type) => { if (type === 'end') done(); };
            window.KomaSpeech.speak('ПРОВЕРКА ГОЛОСА', '1', 'ru-RU', '', 'stand1');
        })""")
        said = await fr.evaluate("() => window.__komaTtsLog().map(x => x.text)")
        ok(said == ['ПРОВЕРКА ГОЛОСА'], 'голос: фраза ушла и завершилась событием end: ' + str(said))

        # ── панель на экране ────────────────────────────────────────────────
        await fr.evaluate("""() => window.KomaUi.show(JSON.stringify({
            text: 'ПРОВЕРКА ПАНЕЛИ', index: 2, total: 5, band: 1, bands: 1,
            playing: true, paused: false, voice: 'стенд Tera TTS' }))""")
        await pg.wait_for_timeout(700)
        panel_text = await pg.locator('[data-koma-panel]').first.get_attribute('data-koma-text')
        panel_total = await pg.locator('[data-koma-panel]').first.get_attribute('data-koma-total')
        ok(panel_text == 'ПРОВЕРКА ПАНЕЛИ', 'панель показывает текст из страницы: ' + str(panel_text))
        ok(panel_total == '5', 'панель показывает номер/всего: index=2 total=' + str(panel_total))

        # ── команды панели доходят до страницы ──────────────────────────────
        forward = await fr.evaluate("""() => {
            window.__cmdSeen = '';
            window.KomaUiCmd = (c) => { window.__cmdSeen = String(c); };
            window.__komaCmd('next');
            return window.__cmdSeen;
        }""")
        ok(forward == 'next', 'кнопка панели доходит до страницы: ' + str(forward))

        # ── сверка с эталоном на экране ─────────────────────────────────────
        await fr.evaluate("""() => {
            window.__komaSpokenReset();
            ['Я РАССЧИТЫВАЮ НА ВАС, ДУХИ', 'ОНА ВСЁ ЕЩЁ ШЕПЧЕТ'].forEach(t => window.KomaUi.spoken(t));
        }""")
        await pg.wait_for_timeout(800)
        # Сверка живёт в своей строке панели: data-koma-hits / data-koma-expected.
        block = pg.locator('[data-koma-hits]').first
        hits = await block.get_attribute('data-koma-hits')
        total = await block.get_attribute('data-koma-expected')
        ok(hits is not None and total == '9', f'сверка с эталоном на экране: {hits} из {total}')
        ok(str(hits) == '2', 'сверка нашла ровно две произнесённые реплики эталона: ' + str(hits))

        # ── отчёт ───────────────────────────────────────────────────────────
        report = await fr.evaluate("() => window.__komaReport()")
        try:
            data = json.loads(report)
        except Exception:
            data = {}
        ok(bool(data) and data.get('plugin') == 'forge-emulator',
           'отчёт __komaReport(): плагин ' + str(data.get('plugin')))
        ok(isinstance(data.get('spoken'), list) and isinstance(data.get('voice'), list),
           f"отчёт: spoken={len(data.get('spoken') or [])}, voice={len(data.get('voice') or [])}, "
           f"expected={len(data.get('expected') or [])}")

        ok(errors == [], 'ошибок страницы нет' + (': ' + '; '.join(errors[:2]) if errors else ''))
        await b.close()


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--apk', default='/home/user/koma-reader-v1.9.42.apk')
    ap.add_argument('--page', default='/home/user/kw9/koma-web.html')
    args = ap.parse_args()
    asyncio.run(run(args))
    print('\nВСЁ ПРОШЛО' if ok_all else '\nЕСТЬ ПАДЕНИЯ')
    sys.exit(0 if ok_all else 1)
