import type { FileMap } from './vfs';

export interface TestCaseResult {
  suite: string;
  name: string;
  passed: boolean;
  durationMs: number;
  error?: string;
}

export interface TestReport {
  results: TestCaseResult[];
  total: number;
  passed: number;
  failed: number;
  durationMs: number;
  generatedAt: string;
  specFiles: string[];
}

function fmt(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function makeExpect(actual: unknown) {
  return {
    toBe(expected: unknown) {
      if (!Object.is(actual, expected)) {
        throw new Error(`expected ${fmt(actual)} to be ${fmt(expected)}`);
      }
    },
    toEqual(expected: unknown) {
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(`expected ${fmt(actual)} to equal ${fmt(expected)}`);
      }
    },
    toBeCloseTo(expected: number, digits = 2) {
      const ok = Math.abs(Number(actual) - expected) < Math.pow(10, -digits) / 2;
      if (!ok) throw new Error(`expected ${fmt(actual)} to be close to ${expected}`);
    },
    toBeTruthy() {
      if (!actual) throw new Error(`expected ${fmt(actual)} to be truthy`);
    },
    toBeFalsy() {
      if (actual) throw new Error(`expected ${fmt(actual)} to be falsy`);
    },
    toContain(needle: string) {
      if (!String(actual).includes(needle)) {
        throw new Error(`expected ${fmt(actual)} to contain ${fmt(needle)}`);
      }
    },
    toHaveLength(length: number) {
      const actualLength = (actual as { length?: number })?.length;
      if (actualLength !== length) {
        throw new Error(`expected length ${actualLength} to be ${length}`);
      }
    },
  };
}

const LIB_PATTERN = /app\/src\/main\/assets\/webapp\/lib\/.*\.js$/;
const SPEC_PATTERN = /app\/src\/test\/js\/.*\.(test|spec)\.js$/;

export async function runTests(files: FileMap): Promise<TestReport> {
  const started = performance.now();
  const specFiles = Object.keys(files).filter((p) => SPEC_PATTERN.test(p)).sort();
  const libFiles = Object.keys(files).filter((p) => LIB_PATTERN.test(p)).sort();

  const results: TestCaseResult[] = [];

  for (const specPath of specFiles) {
    // 1. load the libraries under test into an isolated global object
    const sandbox: Record<string, unknown> = {};
    try {
      for (const libPath of libFiles) {
        const factory = new Function('window', 'globalThis', 'self', files[libPath]);
        factory(sandbox, sandbox, sandbox);
      }
    } catch (error) {
      results.push({
        suite: specPath,
        name: 'load libraries',
        passed: false,
        durationMs: 0,
        error: String((error as Error)?.message ?? error),
      });
      continue;
    }

    const names = Object.keys(sandbox);
    let currentSuite = specPath.split('/').pop() ?? specPath;

    const test = (name: string, fn: () => void) => {
      const t0 = performance.now();
      try {
        fn();
        results.push({
          suite: currentSuite,
          name,
          passed: true,
          durationMs: Math.max(1, Math.round(performance.now() - t0)),
        });
      } catch (error) {
        results.push({
          suite: currentSuite,
          name,
          passed: false,
          durationMs: Math.max(1, Math.round(performance.now() - t0)),
          error: String((error as Error)?.message ?? error),
        });
      }
    };

    const describe = (name: string, fn: () => void) => {
      const previous = currentSuite;
      currentSuite = name;
      fn();
      currentSuite = previous;
    };

    try {
      const factory = new Function(
        ...names,
        'test',
        'expect',
        'describe',
        files[specPath],
      );
      factory(...names.map((n) => sandbox[n]), test, makeExpect, describe);
    } catch (error) {
      results.push({
        suite: specPath,
        name: 'execute spec',
        passed: false,
        durationMs: 0,
        error: String((error as Error)?.message ?? error),
      });
    }
  }

  const passed = results.filter((r) => r.passed).length;
  return {
    results,
    total: results.length,
    passed,
    failed: results.length - passed,
    durationMs: Math.round(performance.now() - started),
    generatedAt: new Date().toISOString(),
    specFiles,
  };
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function reportToJUnitXml(report: TestReport): string {
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuite name="ForgeDeck" tests="${report.total}" failures="${report.failed}" errors="0" time="${(
      report.durationMs / 1000
    ).toFixed(3)}" timestamp="${report.generatedAt}">`,
  ];
  for (const result of report.results) {
    const time = (result.durationMs / 1000).toFixed(3);
    if (result.passed) {
      lines.push(`  <testcase classname="${escapeXml(result.suite)}" name="${escapeXml(result.name)}" time="${time}"/>`);
    } else {
      lines.push(
        `  <testcase classname="${escapeXml(result.suite)}" name="${escapeXml(result.name)}" time="${time}">`,
        `    <failure message="${escapeXml(result.error ?? 'failed')}"/>`,
        '  </testcase>',
      );
    }
  }
  lines.push('</testsuite>');
  return lines.join('\n');
}

export function reportToHtml(report: TestReport): string {
  const rows = report.results
    .map(
      (r) => `<tr class="${r.passed ? 'pass' : 'fail'}">
        <td>${r.passed ? 'PASS' : 'FAIL'}</td>
        <td>${escapeXml(r.suite)}</td>
        <td>${escapeXml(r.name)}</td>
        <td class="msg">${escapeXml(r.error ?? '')}</td>
        <td>${r.durationMs} ms</td>
      </tr>`,
    )
    .join('\n');

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Unit test report</title>
<style>
 body{font-family:system-ui,sans-serif;background:#0f1218;color:#dfe6ee;margin:0;padding:32px}
 h1{font-size:20px;margin:0 0 4px} .meta{color:#7f8b9b;font-size:13px;margin-bottom:20px}
 table{width:100%;border-collapse:collapse;font-size:13px}
 th,td{text-align:left;padding:9px 12px;border-bottom:1px solid #232a34}
 th{color:#8b98a8;font-weight:600;text-transform:uppercase;font-size:11px;letter-spacing:.08em}
 tr.pass td:first-child{color:#3ddc84;font-weight:700}
 tr.fail td:first-child{color:#ff6b6b;font-weight:700}
 tr.fail{background:rgba(255,107,107,.07)}
 .msg{color:#ff9b9b;font-family:ui-monospace,monospace}
 .summary{display:flex;gap:18px;margin:18px 0}
 .pill{background:#161b23;border:1px solid #232a34;border-radius:999px;padding:7px 14px;font-size:13px}
</style></head>
<body>
<h1>Forge Deck — unit tests</h1>
<div class="meta">${new Date(report.generatedAt).toUTCString()} · browser runtime (JS mirror of the JUnit suite)</div>
<div class="summary">
  <span class="pill"><strong>${report.total}</strong> tests</span>
  <span class="pill"><strong style="color:#3ddc84">${report.passed}</strong> passed</span>
  <span class="pill"><strong style="color:#ff6b6b">${report.failed}</strong> failed</span>
  <span class="pill"><strong>${report.durationMs}</strong> ms</span>
</div>
<table><thead><tr><th>Result</th><th>Suite</th><th>Test</th><th>Message</th><th>Time</th></tr></thead>
<tbody>${rows}</tbody></table>
</body></html>`;
}
