// The WebView payload that ships inside the APK as `assets/webapp`.
// It runs unchanged inside a real Android WebView and inside the in-browser
// emulator, which injects the same `window.Android` bridge surface.

export const WEB_INDEX_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>Forge Deck</title>
<link rel="stylesheet" href="style.css" />
</head>
<body>
<div id="app">
  <header class="topbar">
    <div class="brand">
      <span class="logo"></span>
      <div>
        <h1>Forge Deck</h1>
        <p id="pkg">com.forge.droid</p>
      </div>
    </div>
    <button id="themeBtn" class="icon-btn" title="Toggle theme">&#9681;</button>
  </header>

  <main>
    <section class="card accent">
      <h2>Build counter</h2>
      <div class="counter">
        <button id="dec" class="stepper">&minus;</button>
        <span id="count">0</span>
        <button id="inc" class="stepper">+</button>
      </div>
      <p class="hint">Every tap travels through the Android bridge into logcat.</p>
    </section>

    <section class="card">
      <h2>Unit converter</h2>
      <div class="row">
        <input id="celsius" type="number" value="21" step="1" />
        <span class="unit">&deg;C</span>
        <span class="arrow">&rarr;</span>
        <output id="fahrenheit">69.8 &deg;F</output>
      </div>
    </section>

    <section class="card">
      <h2>Release checklist</h2>
      <ul id="checklist" class="checklist"></ul>
      <div class="row">
        <input id="task" placeholder="Add a task" />
        <button id="add" class="primary">Add</button>
      </div>
    </section>

    <section class="card">
      <h2>Bridge</h2>
      <div class="row">
        <button id="toast" class="ghost">Show toast</button>
        <button id="log" class="ghost">Write logcat</button>
      </div>
    </section>
  </main>

  <nav class="bottomnav">
    <button class="nav active">Home</button>
    <button class="nav">Build</button>
    <button class="nav">Device</button>
  </nav>
</div>
<script src="lib/core.js"></script>
<script src="app.js"></script>
</body>
</html>
`;

export const WEB_STYLE_CSS = `:root {
  color-scheme: dark;
  --bg: #0b0f14;
  --surface: #141a21;
  --surface-2: #1b232c;
  --outline: #26313d;
  --text: #e6edf3;
  --muted: #8b9aab;
  --accent: #3ddc84;
  --accent-ink: #06210f;
  --danger: #ff6b6b;
}
body.theme-light {
  color-scheme: light;
  --bg: #f3f6fa;
  --surface: #ffffff;
  --surface-2: #eef2f7;
  --outline: #d8e0ea;
  --text: #16202b;
  --muted: #5d6b7c;
  --accent: #1faa63;
  --accent-ink: #ffffff;
}
* { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
html, body { margin: 0; height: 100%; }
body {
  background: var(--bg);
  color: var(--text);
  font-family: "Inter", "Roboto", system-ui, sans-serif;
  font-size: 15px;
  overflow: hidden;
}
#app { display: flex; flex-direction: column; height: 100%; }
.topbar {
  display: flex; align-items: center; justify-content: space-between;
  padding: 18px 18px 12px;
  border-bottom: 1px solid var(--outline);
  background: linear-gradient(180deg, rgba(61,220,132,0.08), transparent);
}
.brand { display: flex; gap: 12px; align-items: center; }
.logo {
  width: 38px; height: 38px; border-radius: 12px;
  background: conic-gradient(from 140deg, #3ddc84, #2f81f7, #a371f7, #3ddc84);
  box-shadow: 0 6px 18px rgba(61,220,132,0.25);
}
.topbar h1 { margin: 0; font-size: 17px; letter-spacing: 0.2px; }
.topbar p { margin: 2px 0 0; font-size: 11px; color: var(--muted); font-family: "JetBrains Mono", monospace; }
.icon-btn {
  background: var(--surface-2); color: var(--text); border: 1px solid var(--outline);
  width: 36px; height: 36px; border-radius: 12px; font-size: 16px; cursor: pointer;
}
main { flex: 1; overflow-y: auto; padding: 16px 16px 90px; display: flex; flex-direction: column; gap: 14px; }
.card {
  background: var(--surface); border: 1px solid var(--outline); border-radius: 18px;
  padding: 16px; box-shadow: 0 10px 30px rgba(0,0,0,0.18);
}
.card.accent { border-color: rgba(61,220,132,0.35); }
.card h2 { margin: 0 0 12px; font-size: 13px; text-transform: uppercase; letter-spacing: 0.09em; color: var(--muted); }
.hint { margin: 12px 0 0; font-size: 12px; color: var(--muted); }
.counter { display: flex; align-items: center; gap: 18px; }
.counter span { font-size: 40px; font-weight: 700; font-variant-numeric: tabular-nums; min-width: 74px; text-align: center; }
.stepper {
  width: 46px; height: 46px; border-radius: 16px; border: 1px solid var(--outline);
  background: var(--surface-2); color: var(--text); font-size: 22px; cursor: pointer;
}
.stepper:active { transform: scale(0.94); }
.row { display: flex; align-items: center; gap: 10px; }
input {
  flex: 1; min-width: 0; background: var(--surface-2); border: 1px solid var(--outline);
  color: var(--text); border-radius: 12px; padding: 11px 13px; font-size: 15px; font-family: inherit;
}
input:focus { outline: 2px solid rgba(61,220,132,0.45); outline-offset: 1px; }
.unit, .arrow { color: var(--muted); font-size: 13px; }
output { font-family: "JetBrains Mono", monospace; font-size: 14px; color: var(--accent); }
button.primary {
  background: var(--accent); color: var(--accent-ink); border: 0; border-radius: 12px;
  padding: 11px 16px; font-weight: 600; cursor: pointer;
}
button.ghost {
  background: var(--surface-2); border: 1px solid var(--outline); color: var(--text);
  border-radius: 12px; padding: 10px 14px; cursor: pointer; font-size: 13px;
}
.checklist { list-style: none; margin: 0 0 12px; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.checklist li {
  display: flex; align-items: center; gap: 10px; background: var(--surface-2);
  border: 1px solid var(--outline); border-radius: 12px; padding: 10px 12px; font-size: 14px;
}
.checklist li.done { color: var(--muted); text-decoration: line-through; }
.checklist li .tick { width: 18px; height: 18px; border-radius: 6px; border: 1px solid var(--outline); display: grid; place-items: center; font-size: 11px; }
.checklist li.done .tick { background: var(--accent); color: var(--accent-ink); border-color: transparent; }
.bottomnav {
  position: fixed; left: 0; right: 0; bottom: 0; display: flex;
  border-top: 1px solid var(--outline); background: var(--surface); padding: 8px 6px calc(8px + env(safe-area-inset-bottom));
}
.nav { flex: 1; background: none; border: 0; color: var(--muted); padding: 9px 0; font-size: 12px; cursor: pointer; border-radius: 10px; }
.nav.active { color: var(--accent); background: rgba(61,220,132,0.08); }
`;

export const WEB_CORE_JS = `// Pure logic shared by the app and the unit-test suite.
window.ForgeCore = {
  cToF: function (c) {
    return (c * 9) / 5 + 32;
  },
  fToC: function (f) {
    return ((f - 32) * 5) / 9;
  },
  formatTemp: function (c, unit) {
    return c.toFixed(1) + " " + (unit || "C");
  },
  bump: function (value, delta) {
    return value + delta;
  },
  versionCode: function (name) {
    var parts = String(name).split(".");
    var out = [];
    for (var i = 0; i < 3; i++) {
      var n = parseInt(parts[i], 10);
      out.push(isNaN(n) ? 0 : n);
    }
    return out[0] * 10000 + out[1] * 100 + out[2];
  },
  checksum: function (text) {
    var hash = 5381;
    for (var i = 0; i < text.length; i++) {
      hash = (hash * 33) ^ text.charCodeAt(i);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  }
};
`;

export const WEB_APP_JS = `(function () {
  var Core = window.ForgeCore;
  var count = 0;

  function bridge(method, payload) {
    try {
      if (window.Android && typeof window.Android[method] === "function") {
        window.Android[method](payload);
      } else if (window.AndroidBridge) {
        window.AndroidBridge.postMessage(JSON.stringify({ method: method, payload: payload }));
      }
    } catch (err) {
      if (window.console) console.log("bridge error", err);
    }
  }

  function log(line) {
    bridge("log", line);
    console.log("[ForgeDeck] " + line);
  }

  var countEl = document.getElementById("count");
  function render() {
    countEl.textContent = String(count);
  }

  document.getElementById("inc").addEventListener("click", function () {
    count = Core.bump(count, 1);
    render();
    log("counter +1 -> " + count);
  });
  document.getElementById("dec").addEventListener("click", function () {
    count = Core.bump(count, -1);
    render();
    log("counter -1 -> " + count);
  });

  var celsius = document.getElementById("celsius");
  var fahrenheit = document.getElementById("fahrenheit");
  function convert() {
    var value = parseFloat(celsius.value);
    if (isNaN(value)) value = 0;
    fahrenheit.textContent = Core.formatTemp(Core.cToF(value), "F");
  }
  celsius.addEventListener("input", convert);
  convert();

  var list = document.getElementById("checklist");
  var input = document.getElementById("task");
  function addTask(text) {
    var li = document.createElement("li");
    var tick = document.createElement("span");
    tick.className = "tick";
    tick.textContent = "";
    var label = document.createElement("span");
    label.textContent = text;
    li.appendChild(tick);
    li.appendChild(label);
    li.addEventListener("click", function () {
      li.classList.toggle("done");
      log("task toggled: " + text);
    });
    list.appendChild(li);
  }
  ["Debug key generated", "Release keystore created", "Unit tests green"].forEach(addTask);
  document.getElementById("add").addEventListener("click", function () {
    var text = input.value.trim();
    if (!text) return;
    addTask(text);
    input.value = "";
    log("task added: " + text);
  });
  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter") document.getElementById("add").click();
  });

  document.getElementById("toast").addEventListener("click", function () {
    bridge("showToast", "Built with APKForge Studio");
  });
  document.getElementById("log").addEventListener("click", function () {
    bridge("log", "manual logcat write from Forge Deck");
  });

  document.getElementById("themeBtn").addEventListener("click", function () {
    document.body.classList.toggle("theme-light");
    log("theme toggled");
  });

  var navs = document.querySelectorAll(".nav");
  for (var i = 0; i < navs.length; i++) {
    navs[i].addEventListener("click", function () {
      for (var j = 0; j < navs.length; j++) navs[j].classList.remove("active");
      this.classList.add("active");
    });
  }

  log("Forge Deck started");
})();
`;
