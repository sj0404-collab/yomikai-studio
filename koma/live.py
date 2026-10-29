#!/usr/bin/env python3
"""Живой прогон читалки на РЕАЛЬНОЙ странице манги: видеть экран, текст и порядок.

Отличие от forge-emu-test.py: там проверялась синтетическая страница с тремя
репликами. Здесь страница из набора `data/real/dense.jpg` — настоящая манга
(три панели, девять реплик, звуковые эффекты, подписи), и прогон отвечает на
вопросы, которые человек задаёт про приложение:

  • читает ли вообще;            → реплики доходят до голоса (KomaUi.spoken)
  • какой текст читает;          → строка на «экране» + журнал + эталон
  • в каком порядке;             → сравниваем последовательность с эталоном
  • не рвёт ли реплики;          → нет обрывков в 1–2 слова, нет дублей

Эталон — `dense-expected.json` рядом (9 реплик в порядке манги). Сравнение
мягкое по буквам: у OCR свои ошибки, важно попадание в реплику и в порядок.

  python3 koma/live.py                 # страница из /home/user/koma-lab/dense-a.jpg
  python3 koma/live.py --image path    # любая другая страница (эталон не нужен)
"""
import argparse
import asyncio
import difflib
import json
import os
import re
import sys
import zipfile

from playwright.async_api import async_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)
LAB = os.environ.get('KOMA_LAB', '/home/user/koma-lab')
SHOTS = os.path.join(LAB, 'shots')
STUDIO = os.environ.get('STUDIO_URL', 'http://localhost:5174/?koma=1')

ok_all = True


def ok(cond, msg):
    global ok_all
    print(('PASS ' if cond else 'FAIL ') + msg)
    if not cond:
        ok_all = False


def norm(t):
    """Только буквы и цифры, верхний регистр: пунктуация OCR не в счёт."""
    return re.sub(r'[^0-9A-ZА-ЯЁ]', '', str(t or '').upper())


from probe import make_probe_apk  # общая сборка пробного АПК (koma/probe.py)


async def run(args):
    expected = []
    if args.expected and os.path.exists(args.expected):
        expected = json.load(open(args.expected, encoding='utf-8'))

    apk = os.path.join(LAB, 'koma-probe.apk')
    size, page_size = make_probe_apk(args.apk, args.page, apk)
    print(f'пробный АПК: {size} Б (страница {page_size} Б)')

    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--no-sandbox', '--mute-audio', '--disable-gpu',
                                         '--disable-dev-shm-usage', '--renderer-process-limit=1',
                                         '--process-per-site', '--js-flags=--max-old-space-size=1536'])
        ctx = await b.new_context(viewport={'width': 1560, 'height': 1060})
        pg = await ctx.new_page()
        errors = []
        pg.on('console', lambda m: errors.append(m.text[:200]) if m.type == 'error' else None)
        pg.on('pageerror', lambda e: errors.append(str(e)[:200]))

        await pg.goto(STUDIO, wait_until='networkidle', timeout=180000)
        await pg.wait_for_timeout(2500)
        await pg.locator('input[type=file][accept=".apk"]').set_input_files(apk)
        await pg.wait_for_timeout(6500)
        fr = [f for f in pg.frames if f != pg.main_frame][0]

        plugin = await fr.evaluate("() => window.__komaPlugin ? window.__komaPlugin.id : ''")
        ok(bool(plugin), 'плагин стенда применён: ' + (plugin or 'нет'))

        # ── страница манги и модели ─────────────────────────────────────────
        await fr.locator('#imgPick').set_input_files(args.image)
        await pg.wait_for_timeout(2500)
        await fr.locator('#modelPick').set_input_files([
            os.path.join(LAB, 'detection.onnx'), os.path.join(LAB, 'cyrillic.onnx'),
            os.path.join(LAB, 'cyrillic.txt')])
        ready = False
        for _ in range(24):
            await pg.wait_for_timeout(2500)
            if '"r":true' in await fr.evaluate("() => { try { return JSON.stringify({ r: OCR.ready }); } catch (e) { return '{}'; } }"):
                ready = True
                break
        ok(ready, 'модели поднялись (ONNX WASM)')

        await fr.locator('.card').first.click()
        await pg.wait_for_timeout(2500)
        await fr.evaluate("() => { const b = document.querySelector('#btnFullPage');"
                          " if (b) b.click(); else document.querySelector('#btnOcr2').click(); }")
        lines = []
        for _ in range(40):
            await pg.wait_for_timeout(2000)
            raw = await fr.evaluate(
                "() => { try { const d = Reader.regions.get(Reader.page);"
                " return d ? JSON.stringify(d.lines.map(l => l.text)) : ''; } catch (e) { return ''; } }")
            if raw:
                lines = json.loads(raw)
                break
        await pg.screenshot(path=f'{SHOTS}/10-page-recognized.png')
        print(f'\n── распознано реплик: {len(lines)}')
        for i, t in enumerate(lines, 1):
            print(f'   {i}. {t}')
        ok(bool(lines), 'страница распознана и текст есть')
        ok(not any(len(norm(t)) < 6 for t in lines), 'нет реплик-обрывков (меньше 6 букв)')
        ok(len(set(norm(t) for t in lines)) == len(lines), 'нет одинаковых реплик подряд/дублей')

        # ── чтение вслух ────────────────────────────────────────────────────
        await fr.evaluate("() => { window.__komaTtsReset(); window.__komaSpokenReset(); window.__scrollLog = []; }")
        await fr.evaluate("() => { const b = document.querySelector('#btnStartRead')"
                          " || document.querySelector('#btnRead'); if (b) b.click(); }")
        # Скриншот «в процессе»: важно видеть панель, когда она ещё показывает
        # текущую реплику. После конца чтения панель скрывается, и на снимке
        # остаётся только журнал (проверено 29.10).
        mid_shot = False
        for _ in range(60):
            await pg.wait_for_timeout(1000)
            done = await fr.evaluate("() => window.__komaTtsLog().length")
            if not mid_shot and done >= 3:
                await pg.screenshot(path=f'{SHOTS}/11-reading-screen.png')
                mid_shot = True
            if done >= len(lines):
                break
        await pg.wait_for_timeout(1200)
        if not mid_shot:
            await pg.screenshot(path=f'{SHOTS}/11-reading-screen.png')

        said = [x['text'] for x in await fr.evaluate("() => window.__komaTtsLog()") if str(x.get('text', '')).strip()]
        spoken = [x['text'] for x in await fr.evaluate("() => JSON.parse(window.__komaSpoken())")]
        print(f'\n── в голос ушло: {len(said)}, на экран: {len(spoken)}')
        for i, t in enumerate(said, 1):
            print(f'   {i}. {t}')

        ok(bool(said), 'читалка вообще читает (голос получил фразы)')
        ok(len(said) >= len(lines), f'прочитаны все реплики страницы: {len(said)} из {len(lines)}')
        ok(said[:len(lines)] == lines[:len(said)], 'порядок чтения совпадает с порядком реплик')
        ok(len(set(said)) == len(said), 'ничего не прочитано дважды')
        ok(spoken[:3] == said[:3], 'экран показывает то же, что уходит в голос')

        # ── сверка с эталоном (если он есть) ────────────────────────────────
        if expected:
            def best(want):
                wn = norm(want)
                best_i, best_r = -1, 0.0
                for i, t in enumerate(said):
                    r = difflib.SequenceMatcher(None, wn, norm(t)).ratio()
                    if r > best_r:
                        best_r, best_i = r, i
                return best_i, best_r

            print('\n── сверка с эталоном (что должно читаться и в каком порядке)')
            got = []
            for want in expected:
                i, r = best(want)
                got.append(i)
                flag = 'OK ' if r >= 0.75 else '—  '
                print(f'   {flag}{r:.2f}  эталон: {want[:52]}')
                if r < 0.75:
                    print(f'         читалка: {said[i][:60] if i >= 0 else "(не найдено)"}')
            hit = sum(1 for want in expected if best(want)[1] >= 0.75)
            ok(hit >= len(expected) * 0.8, f'эталонные реплики найдены: {hit} из {len(expected)}')
            order_ok = all(a <= b for a, b in zip(got, got[1:]) if a >= 0 and b >= 0)
            ok(order_ok, 'порядок эталонных реплик не нарушен: ' + str(got))

        scroll = await fr.evaluate("() => window.__scrollLog || []")
        moves, prev = 0, (scroll[0][1] if scroll else 0)
        flips = 0
        for _, y in scroll:
            if abs(y - prev) >= 2:
                if moves and ((y > prev) != (moves > 0)):
                    flips += 1
                moves = 1 if y > prev else -1
                prev = y
        print(f'\nлента: {len(scroll)} замеров, смен направления {flips}')
        ok(flips <= 6, f'лента не дёргается: смен направления {flips}')
        ok(errors == [], 'ошибок в консоли нет' + ((': ' + '; '.join(errors[:3])) if errors else ''))
        await pg.screenshot(path=f'{SHOTS}/12-final.png')
        await b.close()


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--apk', default='/tmp/koma-apk/koma-reader-debug.apk')
    ap.add_argument('--page', default='/tmp/koma-apk/koma-web.html')
    ap.add_argument('--image', default='/home/user/koma-lab/dense-a.jpg')
    ap.add_argument('--expected', default=os.path.join(LAB, 'dense-expected.json'))
    a = ap.parse_args()
    os.makedirs(SHOTS, exist_ok=True)
    asyncio.run(run(a))
    print('ВСЁ ПРОШЛО' if ok_all else 'ЕСТЬ ПАДЕНИЯ')
    sys.exit(0 if ok_all else 1)
