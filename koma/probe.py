#!/usr/bin/env python3
"""Сборка «пробного» АПК для стенда.

Зачем это нужно: настоящий АПК кладёт страницу в `assets/koma-web.html`, а
эмулятор APKForge показывает приложение только если внутри есть
`assets/webapp/index.html`. Поэтому для прогонов собирается копия АПК, в которую
добавлена одна запись — наша сегодняшняя страница как webapp. Всё остальное
(манифест, модели, иконки, подписи) остаётся от настоящего АПК, то есть
проверяется та же оболочка, что уходит на телефон.

  python3 koma/probe.py --apk /home/user/koma-reader-v1.9.42.apk \
                        --page /home/user/kw9/koma-web.html \
                        --out /tmp/koma-probe.apk
"""
import argparse
import os
import zipfile


def make_probe_apk(apk_in: str, page_html: str, out: str) -> tuple[int, int]:
    """Дописать страницу в АПК как assets/webapp/index.html. → (размер АПК, размер страницы)."""
    html = open(page_html, 'rb').read()
    with zipfile.ZipFile(apk_in) as zin, zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
        for it in zin.infolist():
            z.writestr(it, zin.read(it.filename))
        z.writestr('assets/webapp/index.html', html)
    return os.path.getsize(out), len(html)


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--apk', required=True)
    ap.add_argument('--page', required=True)
    ap.add_argument('--out', default='/tmp/koma-probe.apk')
    a = ap.parse_args()
    size, page = make_probe_apk(a.apk, a.page, a.out)
    print(f'{a.out}: {size} Б (страница {page} Б)')
