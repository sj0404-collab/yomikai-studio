/**
 * Мосты Android-оболочки для стенда (KOMA-режим студии).
 *
 * Зачем: читалка в АПК не говорит сама — речь даёт системный Tera TTS через
 * `KomaSpeech`, панель чтения нативная через `KomaUi`, обновления и Lens — через
 * `KomaApp`, плагины — через `KomaPlugins`. В браузере этих мостов нет, и
 * страница честно уходит на Web Speech (в headless его тоже нет). Поэтому стенд
 * подсовывает те же мосты и делает их ВИДИМЫМИ: что уходит в голос, что стоит в
 * «нативной панели», какой плагин применился.
 *
 * Мосты повторяют АПК-протокол:
 *   KomaSpeech.speak(text, rate, lang, voice, id) → событие через
 *     window.__komaSpeechEvent(id, 'start' | 'end' | 'error')
 *   KomaUi.show(json) / KomaUi.hide() / KomaUi.spoken(text)
 *   KomaPlugins.all() — список плагинов в JSON
 *
 * Плюс служебные функции для прогонов (их видит playwright):
 *   __komaTtsLog() / __komaTtsReset() — что ушло в голос, по порядку
 *   __komaSpoken() / __komaSpokenReset() — что показано на «экране»
 *   __komaPanel() — состояние нативной панели
 *   __komaCmd(cmd) — нажатие кнопки панели (toggle/next/repeat/stop)
 *   __scrollLog — замеры прокрутки ленты (рывки авточтения)
 */

export const KOMA_NOTES = [
  'KomaSpeech · голос системный (в АПК — Tera TTS)',
  'KomaUi · панель чтения нативная',
  'KomaApp · версия и обновление',
  'KomaPlugins · плагины JSON',
];

/** Собрать <script> с мостами. plugin — объект плагина стенда (JSON-строка). */
export function komaShim(pluginJson: string): string {
  return `<script>(function(){
  var PLUGIN = ${pluginJson || '{}'};
  var SPEECH_MS = 620;                 // сколько «звучит» одна фраза в стенде
  var ttsLog = [], spokenLog = [], panel = { visible: false, state: null };
  var timers = {};

  function toJson(v) { try { return JSON.stringify(v); } catch (e) { return '{}'; } }

  // ── журнал «что ушло в голос» ─────────────────────────────────────────────
  window.__komaTtsLog = function () { return ttsLog.slice(); };
  window.__komaTtsReset = function () { ttsLog = []; };
  window.__komaSpoken = function () { return toJson(spokenLog.slice()); };
  window.__komaSpokenReset = function () { spokenLog = []; };
  window.__komaPanel = function () { return { visible: panel.visible, state: panel.state }; };

  // ── прокрутка ленты: по ней видно, дёргается ли авточтение ─────────────────
  // Прокрутка ленты: событие scroll не всплывает, поэтому слушаем на перехвате
  // (true) — так видно ЛЮБОЙ прокручиваемый контейнер читалки, а не угаданный.
  window.__scrollLog = [];
  window.__scrollEl = null;
  function logScroll(target) {
    var el = (target && target.scrollTop !== undefined) ? target : null;
    if (el && el.scrollHeight > el.clientHeight + 4) window.__scrollEl = el;
    var node = el || window.__scrollEl;
    var y = node ? node.scrollTop : (window.scrollY || 0);
    var last = window.__scrollLog[window.__scrollLog.length - 1];
    if (last && last[1] === Math.round(y)) return;      // только изменения
    window.__scrollLog.push([Date.now(), Math.round(y)]);
    if (window.__scrollLog.length > 4000) window.__scrollLog.shift();
  }
  document.addEventListener('scroll', function (e) { logScroll(e.target); }, true);
  window.addEventListener('scroll', function () { logScroll(null); }, true);
  setTimeout(function () {
    var cands = ['reader', 'feed', 'viewer', 'pages'];
    for (var i = 0; i < cands.length; i++) {
      var el = document.getElementById(cands[i]);
      if (el && el.scrollHeight > el.clientHeight + 4) { window.__scrollEl = el; break; }
    }
  }, 1500);

  // ── KomaSpeech: голос ─────────────────────────────────────────────────────
  window.KomaSpeech = {
    speak: function (text, rate, lang, voice, id) {
      var t = String(text || '');
      ttsLog.push({ text: t, rate: rate, lang: lang, voice: voice, id: id, at: Date.now() });
      if (window.KomaUi && window.KomaUi.__setPanel) window.KomaUi.__setPanel(t);
      clearTimeout(timers[id]);
      timers[id] = setTimeout(function () {
        var fire = window.__komaSpeechEvent;
        if (typeof fire === 'function') {
          fire(id, 'start');
          setTimeout(function () { fire(id, 'end'); delete timers[id]; }, SPEECH_MS);
        }
      }, 40);
    },
    cancel: function () {
      for (var k in timers) { clearTimeout(timers[k]); }
      timers = {};
    },
    status: function () { return toJson({ engine: 'стенд Tera TTS', ready: true, lang: 'ru-RU' }); },
    engines: function () { return toJson(['стенд Tera TTS', 'Android TTS']); },
    useEngine: function () { return true; },
    voices: function () {
      return toJson([
        { name: 'ru-RU-Tera', lang: 'ru-RU', local: true, default: true },
        { name: 'ru-RU-Standard', lang: 'ru-RU', local: true }
      ]);
    }
  };

  // ── KomaUi: панель чтения ─────────────────────────────────────────────────
  window.KomaUi = {
    show: function (json) {
      try { panel.state = JSON.parse(String(json || '{}')); } catch (e) { panel.state = null; }
      panel.visible = true;
      if (panel.state && panel.state.text) {
        var last = spokenLog[spokenLog.length - 1];
        if (!last || last.text !== panel.state.text) {
          spokenLog.push({ text: panel.state.text, at: Date.now() });
        }
      }
      window.dispatchEvent(new CustomEvent('koma:panel', { detail: panel.state }));
    },
    hide: function () {
      panel.visible = false;
      window.dispatchEvent(new CustomEvent('koma:panel', { detail: null }));
    },
    /** То, что страница собирается произнести: экран и журнал стенда. */
    spoken: function (text) {
      var t = String(text || '');
      var last = spokenLog[spokenLog.length - 1];
      if (!last || last.text !== t) spokenLog.push({ text: t, at: Date.now() });
    },
    __setPanel: function (text) {
      if (!panel.state) panel.state = {};
      panel.state.text = text;
    }
  };
  window.__komaCmd = function (cmd) {
    try { if (typeof window.KomaUiCmd === 'function') window.KomaUiCmd(String(cmd)); } catch (e) {}
    return true;
  };

  // ── KomaApp: версия и обновление ──────────────────────────────────────────
  window.KomaApp = {
    version: function () { return toJson({ version: 'стенд', code: 0, stand: true }); },
    checkUpdate: function () { return toJson({ ok: false, reason: 'стенд: обновлений нет' }); },
    reloadNow: function () { return true; },
    lensSelfTest: function () { return toJson({ ok: false, reason: 'стенд: Lens не запускается' }); }
  };

  // ── KomaPlugins: плагины (правила читалки меняются файлом, без сборки) ────
  var plugins = [PLUGIN];
  window.KomaPlugins = {
    all: function () { return toJson(plugins); },
    where: function () { return toJson({ dir: '/files/plugins', assets: '/assets/plugins' }); },
    reload: function () { return toJson({ ok: true, saved: 0 }); },
    importUris: function () { return toJson({ ok: false, saved: 0, error: 'в эмуляторе файлов нет' }); },
    pick: function () { return false; }
  };
  window.__komaPlugin = PLUGIN && PLUGIN.id ? PLUGIN : null;
  window.__komaBridges = 'KomaSpeech · KomaUi · KomaApp · KomaPlugins';

  /**
   * Отчёт прогона — то, что видно на экране, в машинном виде:
   * что ушло в голос, что показано, что на панели, какой плагин был.
   * Кнопка «Отчёт» в панели стенда скачивает его файлом.
   */
  window.__komaReport = function () {
    return toJson({
      at: new Date().toISOString(),
      plugin: (PLUGIN && PLUGIN.id) || null,
      pluginRules: (PLUGIN && PLUGIN.rules) || null,
      bridges: window.__komaBridges,
      spoken: spokenLog,
      voice: ttsLog,
      panel: panel,
      scroll: window.__scrollLog,
      expected: (PLUGIN && PLUGIN.koma && PLUGIN.koma.forge && PLUGIN.koma.forge.expected) || []
    });
  };

  // Плагин кладём в тот же список, который читает страница.
  try {
    if (window.Plugins && typeof window.Plugins.load === 'function') window.Plugins.load();
  } catch (e) {}
})();</script>`;
}
