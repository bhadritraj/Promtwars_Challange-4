/**
 * VolunteerIQ 2026 — Test Suite
 * Runs against AppCore directly (no DOM scraping) so it works both in the
 * browser (tests.html) and headless via `node tests.js` for CI.
 * Deliberately weighted toward edge cases, per SME feedback that most
 * teams only test the happy path.
 */

function runAllTests(AppCore) {
  const results = [];
  function test(name, fn) {
    try {
      fn();
      results.push({ name, pass: true });
    } catch (e) {
      results.push({ name, pass: false, error: e.message });
    }
  }
  function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
  function assertEqual(a, b, msg) { if (a !== b) throw new Error(msg || `expected ${b}, got ${a}`); }

  // ---------- HAPPY PATH ----------
  test('parseCSV: parses a well-formed CSV', () => {
    const { zones, errors } = AppCore.parseCSV('zone,capacity,waitMinutes,headcount\nGate A,80,10,300');
    assertEqual(errors.length, 0);
    assertEqual(zones['Gate A'].capacity, 80);
    assertEqual(zones['Gate A'].waitMinutes, 10);
    assertEqual(zones['Gate A'].headcount, 300);
  });

  test('parseCSV: parses multiple rows', () => {
    const { zones } = AppCore.parseCSV('zone,capacity\nGate A,50\nGate B,90');
    assertEqual(Object.keys(zones).length, 2);
  });

  test('classifySeverity: normal below thresholds', () => {
    assertEqual(AppCore.classifySeverity(40, 5), 'normal');
  });

  test('classifySeverity: elevated at 75%+', () => {
    assertEqual(AppCore.classifySeverity(80, 5), 'elevated');
  });

  test('classifySeverity: critical at 90%+', () => {
    assertEqual(AppCore.classifySeverity(95, 5), 'critical');
  });

  // ---------- EDGE CASES: empty / malformed input ----------
  test('parseCSV: empty string returns error, not a throw', () => {
    const { zones, errors } = AppCore.parseCSV('');
    assertEqual(Object.keys(zones).length, 0);
    assert(errors.length > 0, 'expected an error message for empty input');
  });

  test('parseCSV: null input does not throw', () => {
    const { zones, errors } = AppCore.parseCSV(null);
    assertEqual(Object.keys(zones).length, 0);
    assert(errors.length > 0);
  });

  test('parseCSV: undefined input does not throw', () => {
    const { errors } = AppCore.parseCSV(undefined);
    assert(errors.length > 0);
  });

  test('parseCSV: header-only file (no data rows) is reported as error', () => {
    const { zones, errors } = AppCore.parseCSV('zone,capacity');
    assertEqual(Object.keys(zones).length, 0);
    assert(errors.length > 0);
  });

  test('parseCSV: missing required "zone" column is reported', () => {
    const { errors } = AppCore.parseCSV('capacity,waitMinutes\n80,10');
    assert(errors.some(e => /zone/i.test(e)));
  });

  test('parseCSV: non-numeric capacity is ignored, not crashed on', () => {
    const { zones, errors } = AppCore.parseCSV('zone,capacity\nGate A,not-a-number');
    assertEqual(zones['Gate A'].capacity, undefined);
    assert(errors.length > 0);
  });

  test('parseCSV: blank lines between rows are skipped safely', () => {
    const { zones } = AppCore.parseCSV('zone,capacity\nGate A,50\n\n\nGate B,60');
    assertEqual(Object.keys(zones).length, 2);
  });

  test('parseCSV: row with missing zone name is skipped, others still load', () => {
    const { zones, errors } = AppCore.parseCSV('zone,capacity\n,50\nGate B,60');
    assertEqual(Object.keys(zones).length, 1);
    assert(errors.length > 0);
  });

  test('parseCSV: capacity values are clamped to 0-100', () => {
    const { zones } = AppCore.parseCSV('zone,capacity\nGate A,150\nGate B,-20');
    assertEqual(zones['Gate A'].capacity, 100);
    assertEqual(zones['Gate B'].capacity, 0);
  });

  test('parseCSV: extra unrecognized columns are ignored, not fatal', () => {
    const { zones, errors } = AppCore.parseCSV('zone,capacity,notes\nGate A,50,"busy day"');
    assertEqual(zones['Gate A'].capacity, 50);
    assertEqual(errors.length, 0);
  });

  test('parseCSV: header is case-insensitive', () => {
    const { zones } = AppCore.parseCSV('ZONE,CAPACITY\nGate A,70');
    assertEqual(zones['Gate A'].capacity, 70);
  });

  // ---------- EDGE CASES: severity boundaries ----------
  test('classifySeverity: exactly at 75 boundary is elevated', () => {
    assertEqual(AppCore.classifySeverity(75, undefined), 'elevated');
  });

  test('classifySeverity: 74 is still normal (below boundary)', () => {
    assertEqual(AppCore.classifySeverity(74, undefined), 'normal');
  });

  test('classifySeverity: exactly at 90 boundary is critical', () => {
    assertEqual(AppCore.classifySeverity(90, undefined), 'critical');
  });

  test('classifySeverity: undefined capacity and wait defaults to normal', () => {
    assertEqual(AppCore.classifySeverity(undefined, undefined), 'normal');
  });

  test('classifySeverity: high wait alone triggers critical even with low capacity', () => {
    assertEqual(AppCore.classifySeverity(20, 30), 'critical');
  });

  test('classifySeverity: moderate wait alone triggers elevated', () => {
    assertEqual(AppCore.classifySeverity(20, 16), 'elevated');
  });

  // ---------- EDGE CASES: log entries ----------
  test('addLogEntry: caps log at 100 entries (no unbounded memory growth)', () => {
    AppCore.logEntries = [];
    for (let i = 0; i < 120; i++) AppCore.addLogEntry({ text: 'entry ' + i, severity: 'normal' });
    assertEqual(AppCore.logEntries.length, 100);
  });

  test('addLogEntry: most recent entry is at index 0', () => {
    AppCore.logEntries = [];
    AppCore.addLogEntry({ text: 'first', severity: 'normal' });
    AppCore.addLogEntry({ text: 'second', severity: 'normal' });
    assertEqual(AppCore.logEntries[0].text, 'second');
  });

  // ---------- EDGE CASES: reasoning composer (simulation engine) ----------
  test('GeminiService offline composer: empty prompt handled without throwing', () => {
    if (typeof GeminiService === 'undefined') return; // skip in headless-only context
    const text = GeminiService._composeReasoning('', {});
    assert(/OBSERVATION/.test(text));
  });

  test('GeminiService offline composer: medical keyword overrides crowd logic', () => {
    if (typeof GeminiService === 'undefined') return;
    const text = GeminiService._composeReasoning('fan collapsed near section 100', { zone: 'Section 100' });
    assert(/medical/i.test(text));
  });

  test('GeminiService offline composer: no data provided still produces reasoning, not a crash', () => {
    if (typeof GeminiService === 'undefined') return;
    const text = GeminiService._composeReasoning('queue building at gate A', {});
    assert(/No live data provided/.test(text));
  });

  const passed = results.filter(r => r.pass).length;
  return { results, passed, total: results.length };
}

// Allow running headless via `node tests.js`
if (typeof module !== 'undefined' && require.main === module) {
  const { AppCore } = require('./app.js');
  const { results, passed, total } = runAllTests(AppCore);
  results.forEach(r => console.log((r.pass ? 'PASS' : 'FAIL') + ' - ' + r.name + (r.error ? ' :: ' + r.error : '')));
  console.log(`\n${passed}/${total} passed`);
  process.exit(passed === total ? 0 : 1);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { runAllTests };
}
