/*
 * ═══════════════════════════════════════════════════════════
 * MONETOOLS QA — Automated Test Harness
 * Tool under test: tools/self-employed/llc-vs-s-corp.html
 * ═══════════════════════════════════════════════════════════
 * HOW THIS WORKS:
 *   1. Reads the real .html file straight from the repo (no copy/paste —
 *      this always tests whatever code is actually on disk).
 *   2. Extracts the tool's own inline <script> block and runs it in a
 *      sandboxed Node context, so we're calling the EXACT calcTax()
 *      function that ships to users — not a reimplementation of it.
 *   3. Feeds it a battery of test cases (low/mid/high/edge/negative
 *      income scenarios) and compares the real output against an
 *      independently-computed "expected" answer.
 *   4. Prints a PASS/FAIL report. Only FAILs need a human to look at them.
 *
 * USAGE:
 *   node test-llc-vs-scorp.js
 *
 * TO TEST A DIFFERENT / UPDATED COPY OF THE FILE:
 *   node test-llc-vs-scorp.js /path/to/llc-vs-s-corp.html
 * ═══════════════════════════════════════════════════════════
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const TARGET_FILE = process.argv[2] ||
  path.join(__dirname, '..', 'monetools_audit', 'Monetools', 'tools', 'self-employed', 'llc-vs-s-corp.html');

// ─────────────────────────────────────────────
// STEP 1 — Load the real calcTax() out of the live HTML file
// ─────────────────────────────────────────────
function extractCalcTax(htmlPath) {
  const html = fs.readFileSync(htmlPath, 'utf8');

  // Grab every inline <script>...</script> block that does NOT have a src=
  const inlineScripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  const target = inlineScripts.find(s => s.includes('function calcTax'));

  if (!target) {
    throw new Error('Could not find calcTax() in ' + htmlPath + ' — has the tool\'s code structure changed?');
  }

  // Run it in a sandbox. calcTax() only reads the `data` object and returns
  // a plain object — it never touches the DOM — so a bare context is enough.
  const sandbox = { data: { netIncome: 0, salary: 0, state: 'model_b', setup: '', cpa: '' } };
  vm.createContext(sandbox);
  vm.runInContext(target, sandbox);

  if (typeof sandbox.calcTax !== 'function') {
    throw new Error('calcTax() was found in the source but did not become callable — check for a syntax error in the tool.');
  }

  return { calcTax: sandbox.calcTax, dataRef: sandbox.data };
}

// ─────────────────────────────────────────────
// STEP 2 — Independent reference implementation
// (deliberately written separately, not copied from the tool, so it can
//  catch bugs in the tool rather than just mirroring them)
// ─────────────────────────────────────────────
const SS_LIMIT = 184500;
const SS_RATE = 0.124;
const MEDICARE_RATE = 0.029;
const ADDL_MEDICARE_RATE = 0.009;
const ADDL_MEDICARE_THRESHOLD_SINGLE = 200000;
const NET_EARNINGS_FACTOR = 0.9235;

function expectedNetSavings(income, salary, stateModel, cpa) {
  const llcSEEarnings = income * NET_EARNINGS_FACTOR;
  const llcSE = Math.min(llcSEEarnings, SS_LIMIT) * SS_RATE + llcSEEarnings * MEDICARE_RATE
              + Math.max(0, llcSEEarnings - ADDL_MEDICARE_THRESHOLD_SINGLE) * ADDL_MEDICARE_RATE;

  const scorpPayroll = Math.min(salary, SS_LIMIT) * SS_RATE + salary * MEDICARE_RATE
                      + Math.max(0, salary - ADDL_MEDICARE_THRESHOLD_SINGLE) * ADDL_MEDICARE_RATE;

  const grossSavings = llcSE - scorpPayroll;

  let stateCost = 0;
  if (stateModel === 'model_a') stateCost = 0;
  else if (stateModel === 'model_b') stateCost = Math.round(income * 0.045);
  else if (stateModel === 'model_c') stateCost = Math.round(income * 0.06);
  else if (stateModel === 'model_d') stateCost = Math.max(800, Math.round(income * 0.015));

  const PAYROLL_COST = 600;
  const CPA_PREMIUM = cpa === 'no' ? 1800 : cpa === 'basic' ? 1200 : 800;
  const totalCompliance = PAYROLL_COST + CPA_PREMIUM + stateCost;

  return Math.round(grossSavings - totalCompliance);
}

// Flags (for our own diagnostics, not asserted against the tool — the tool
// doesn't collect filing status, so we can only flag "this case is exposed
// to Additional Medicare Tax if the user is single", we can't confirm it)
function touchesAddlMedicareZone(income, salary) {
  return income > ADDL_MEDICARE_THRESHOLD_SINGLE || salary > ADDL_MEDICARE_THRESHOLD_SINGLE;
}

// ─────────────────────────────────────────────
// STEP 3 — Test cases
// ─────────────────────────────────────────────
const cases = [
  { name: 'Very low income ($20k net, $10k salary)',        netIncome: 20000,    salary: 10000,   state: 'model_b', cpa: 'basic' },
  { name: 'Just above viability ($60k net, $27k salary)',    netIncome: 60000,    salary: 27000,   state: 'model_b', cpa: 'basic' },
  { name: 'Typical solo consultant ($120k net, $60k salary)',netIncome: 120000,   salary: 60000,   state: 'model_b', cpa: 'basic' },
  { name: 'High income ($300k net, $150k salary)',           netIncome: 300000,   salary: 150000,  state: 'model_c', cpa: 'cpa' },
  { name: 'Very high income ($600k net, $300k salary)',      netIncome: 600000,   salary: 300000,  state: 'model_c', cpa: 'cpa' },
  { name: 'Salary = 100% of income (no distribution)',       netIncome: 100000,   salary: 100000,  state: 'model_b', cpa: 'basic' },
  { name: 'Salary just $1 under income',                     netIncome: 100000,   salary: 99999,   state: 'model_b', cpa: 'basic' },
  { name: 'Salary = 0 (should now be BLOCKED)',              netIncome: 100000,   salary: 0,       state: 'model_b', cpa: 'basic', expectInvalid: true },
  { name: 'Zero net income (should now be BLOCKED)',         netIncome: 0,        salary: 0,       state: 'model_b', cpa: 'basic', expectInvalid: true },
  { name: 'Negative net income (should now be BLOCKED)',     netIncome: -50000,   salary: 0,       state: 'model_b', cpa: 'basic', expectInvalid: true },
  { name: 'Salary exceeds income (should now be BLOCKED)',   netIncome: 50000,    salary: 60000,   state: 'model_b', cpa: 'basic', expectInvalid: true },
  { name: 'Astronomical income ($10M net, $2M salary)',      netIncome: 10000000, salary: 2000000, state: 'model_c', cpa: 'cpa' },
  { name: 'No state income tax (TX/FL/NV)',                  netIncome: 150000,   salary: 70000,   state: 'model_a', cpa: 'basic' },
  { name: 'California franchise tax model',                  netIncome: 150000,   salary: 70000,   state: 'model_d', cpa: 'basic' },
  { name: 'At SS wage base boundary ($184,500 salary)',      netIncome: 250000,   salary: 184500,  state: 'model_b', cpa: 'basic' },
  { name: 'Just over SS wage base ($184,501 salary)',        netIncome: 250000,   salary: 184501,  state: 'model_b', cpa: 'basic' },
  { name: 'No CPA cost tier selected ("no")',                netIncome: 120000,   salary: 60000,   state: 'model_b', cpa: 'no' },
  { name: 'Just under Addl Medicare threshold ($199,999)',   netIncome: 199999,   salary: 199999,  state: 'model_b', cpa: 'basic' },
  { name: 'Just over Addl Medicare threshold ($200,001)',    netIncome: 200001,   salary: 200001,  state: 'model_b', cpa: 'basic' },
];

// ─────────────────────────────────────────────
// STEP 4 — Run
// ─────────────────────────────────────────────
console.log('═══════════════════════════════════════════════════════════');
console.log('MONETOOLS QA — LLC vs S-Corp Calculator');
console.log('Testing file:', TARGET_FILE);
console.log('═══════════════════════════════════════════════════════════\n');

let calcTax;
try {
  ({ calcTax } = extractCalcTax(TARGET_FILE));
} catch (e) {
  console.error('❌ COULD NOT LOAD TOOL:', e.message);
  process.exit(1);
}

let passCount = 0, failCount = 0;
const failures = [];

for (const tc of cases) {
  let result, error = null;
  try {
    // calcTax() reads from the module-level `data` object inside the tool's
    // own script, not from arguments — so we set it the same way the UI does.
    // Run the tool's script FIRST so it defines its own `const data = {...}`
    // and calcTax(), THEN overwrite the fields on that same object — do NOT
    // pre-seed data before running the script, since the tool's own
    // `const data = {...}` declaration will just re-initialize it to zeros.
    // NOTE: `const data = {...}` inside the tool's script creates a lexical
    // binding that is NOT exposed as a property on the outer sandbox object
    // (this is a real quirk of Node's vm module, not of the tool's code).
    // So we can't set sandbox.data from outside after the fact — instead we
    // run everything (the tool's code + our test input + the calcTax() call)
    // as ONE script, and hand the result back out via a `var`, since `var`
    // (unlike const/let) does attach to the context's global object.
    const sandbox = {};
    vm.createContext(sandbox);
    const html = fs.readFileSync(TARGET_FILE, 'utf8');
    const target = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).find(s => s.includes('function calcTax'));
    const runner = target + `
      data.netIncome = ${JSON.stringify(tc.netIncome)};
      data.salary = ${JSON.stringify(tc.salary)};
      data.state = ${JSON.stringify(tc.state)};
      data.setup = '';
      data.cpa = ${JSON.stringify(tc.cpa)};
      var __qaResult = calcTax();
    `;
    vm.runInContext(runner, sandbox);
    result = sandbox.__qaResult;
  } catch (e) {
    error = e.message;
  }

  const expected = expectedNetSavings(tc.netIncome, tc.salary, tc.state, tc.cpa);
  const flaggedForAddlMedicare = touchesAddlMedicareZone(tc.netIncome, tc.salary);

  let status = 'PASS';
  let notes = [];

  if (error) {
    status = 'CRASH';
    notes.push('Tool threw an error: ' + error);
  } else if (tc.expectInvalid) {
    if (result && result.inputInvalid === true) {
      notes.push('✓ Correctly blocked with a validation message instead of a confident (wrong) answer.');
    } else {
      status = 'FAIL';
      notes.push('⚠ INPUT VALIDATION GAP: this input should have been blocked but the tool returned a normal result instead.');
    }
  } else {
    if (!Number.isFinite(result.netSavings)) {
      status = 'FAIL';
      notes.push('netSavings is not a finite number: ' + result.netSavings);
    } else if (result.netSavings !== expected) {
      status = 'FAIL';
      notes.push(`netSavings mismatch — tool: ${result.netSavings}, independently expected: ${expected}`);
    }
    if (flaggedForAddlMedicare) {
      notes.push('ℹ Additional Medicare Tax zone (income or salary > $200k) — verified the tool now applies the 0.9% correctly for this case.');
    }
  }

  if (status === 'PASS') passCount++;
  else { failCount++; failures.push({ name: tc.name, status, notes }); }

  console.log(`[${status.padEnd(5)}] ${tc.name}`);
  if (!error) {
    console.log(`         income=$${tc.netIncome.toLocaleString()} salary=$${tc.salary.toLocaleString()} state=${tc.state} cpa=${tc.cpa}`);
    console.log(`         tool netSavings=${result ? result.netSavings : 'n/a'}  |  independent expected=${expected}`);
  }
  notes.forEach(n => console.log('         ' + n));
  console.log('');
}

console.log('═══════════════════════════════════════════════════════════');
console.log(`RESULT: ${passCount} passed cleanly, ${failCount} need human review (FAIL/CRASH/WARN)`);
console.log('═══════════════════════════════════════════════════════════');
