/*
 * ═══════════════════════════════════════════════════════════
 * MONETOOLS QA — Automated Test Harness
 * Tool under test: tools/self-employed/s-corp-readiness.html
 * ═══════════════════════════════════════════════════════════
 * This tool is a 100-point rubric scorer (not a dollar calculator), so the
 * checks are different from the LLC vs S-Corp harness:
 *   1. Does each dimension's score land in the bucket the code says it should?
 *   2. Does the total always equal the sum of its parts?
 *   3. Do the stage thresholds (ready/almost/notyet/already) fire correctly,
 *      including the "already an S-Corp" override?
 *   4. Do all 7 blocker conditions (including the two CA/NY ones just added)
 *      fire exactly when they should — no more, no less?
 *   5. Never crash on blank/unanswered fields.
 *
 * USAGE: node test-s-corp-readiness.js [path-to-html]
 * ═══════════════════════════════════════════════════════════
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const TARGET_FILE = process.argv[2] ||
  path.join(__dirname, '..', 'monetools_audit', 'Monetools', 'tools', 'self-employed', 's-corp-readiness.html');

function runCalcScore(htmlPath, d) {
  const html = fs.readFileSync(htmlPath, 'utf8');
  const target = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).find(s => s.includes('function calcScore'));
  if (!target) throw new Error('Could not find calcScore() — has the tool\'s structure changed?');

  const sandbox = {};
  vm.createContext(sandbox);
  const runner = target + `
    d.income = ${JSON.stringify(d.income)};
    d.structure = ${JSON.stringify(d.structure)};
    d.finances = ${JSON.stringify(d.finances)};
    d.cpa = ${JSON.stringify(d.cpa)};
    d.payroll = ${JSON.stringify(d.payroll)};
    d.salary = ${JSON.stringify(d.salary)};
    d.state = ${JSON.stringify(d.state)};
    var __qaResult = calcScore();
  `;
  vm.runInContext(runner, sandbox);
  return sandbox.__qaResult;
}

// ─────────────────────────────────────────────
// Independent scoring reference (mirrors the rubric documented in the code,
// written separately to catch drift between the two)
// ─────────────────────────────────────────────
function expectedScores(d) {
  const inputInvalid = d.income < 0;
  const incomeForScoring = Math.max(0, d.income);
  const income = incomeForScoring >= 100000 ? 25 : incomeForScoring >= 80000 ? 20 : incomeForScoring >= 65000 ? 12 : incomeForScoring >= 50000 ? 6 : 0;
  const structure = { sole: 0, llc_new: 10, llc_est: 20, scorp: 20 }[d.structure] || 0;
  const finances = { mixed: 0, basic: 10, clean: 20 }[d.finances] || 0;
  const cpa = { none: 0, basic: 7, cpa: 15 }[d.cpa] || 0;
  const payroll = { none: 0, researched: 6, ready: 10 }[d.payroll] || 0;
  const salary = { no: 0, rough: 5, researched: 10 }[d.salary] || 0;
  const total = income + structure + finances + cpa + payroll + salary;

  let stage;
  if (d.structure === 'scorp') stage = 'already';
  else if (total >= 80) stage = 'ready';
  else if (total >= 55) stage = 'almost';
  else stage = 'notyet';

  const expectedBlockerCount =
    (inputInvalid ? 1 : 0) +
    (incomeForScoring < 80000 ? 1 : 0) +
    (d.structure === 'sole' ? 1 : 0) +
    (d.finances === 'mixed' ? 1 : 0) +
    (d.cpa === 'none' ? 1 : 0) +
    (d.salary === 'no' ? 1 : 0) +
    (d.state === 'ca' ? 1 : 0) +
    (d.state === 'ny' ? 1 : 0);

  return { total, stage, expectedBlockerCount, parts: { income, structure, finances, cpa, payroll, salary } };
}

// ─────────────────────────────────────────────
// Test cases — hand-picked boundary cases plus a full combinatorial sweep
// ─────────────────────────────────────────────
const boundaryCases = [
  { name: 'Empty/unanswered (all blank)',            income: 0,      structure: '',        finances: '',      cpa: '',      payroll: '',        salary: '',          state: '' },
  { name: 'Perfect score (max everything)',           income: 150000, structure: 'llc_est',  finances: 'clean', cpa: 'cpa',   payroll: 'ready',    salary: 'researched', state: 'notax' },
  { name: 'Already an S-Corp (should override stage)',income: 30000,  structure: 'scorp',    finances: 'mixed', cpa: 'none',  payroll: 'none',     salary: 'no',         state: 'ca' },
  { name: 'Income just under $50k bucket',            income: 49999,  structure: 'llc_est',  finances: 'clean', cpa: 'cpa',   payroll: 'ready',    salary: 'researched', state: 'notax' },
  { name: 'Income exactly $50k bucket',               income: 50000,  structure: 'llc_est',  finances: 'clean', cpa: 'cpa',   payroll: 'ready',    salary: 'researched', state: 'notax' },
  { name: 'Income just under $65k bucket',             income: 64999,  structure: 'llc_est',  finances: 'clean', cpa: 'cpa',   payroll: 'ready',    salary: 'researched', state: 'notax' },
  { name: 'Income exactly $65k bucket',                income: 65000,  structure: 'llc_est',  finances: 'clean', cpa: 'cpa',   payroll: 'ready',    salary: 'researched', state: 'notax' },
  { name: 'Income just under $80k bucket',             income: 79999,  structure: 'llc_est',  finances: 'clean', cpa: 'cpa',   payroll: 'ready',    salary: 'researched', state: 'notax' },
  { name: 'Income exactly $80k bucket',                income: 80000,  structure: 'llc_est',  finances: 'clean', cpa: 'cpa',   payroll: 'ready',    salary: 'researched', state: 'notax' },
  { name: 'Income just under $100k bucket',            income: 99999,  structure: 'llc_est',  finances: 'clean', cpa: 'cpa',   payroll: 'ready',    salary: 'researched', state: 'notax' },
  { name: 'Income exactly $100k bucket',               income: 100000, structure: 'llc_est',  finances: 'clean', cpa: 'cpa',   payroll: 'ready',    salary: 'researched', state: 'notax' },
  { name: 'Right at "almost"/"ready" boundary',        income: 100000, structure: 'llc_new', finances: 'basic', cpa: 'basic', payroll: 'researched', salary: 'rough', state: 'notax' },
  { name: 'Right at "notyet"/"almost" boundary',       income: 65000, structure: 'llc_new', finances: 'basic', cpa: 'basic', payroll: 'none', salary: 'no', state: 'notax' },
  { name: 'California — should now trigger CA blocker', income: 150000, structure: 'llc_est', finances: 'clean', cpa: 'cpa', payroll: 'ready', salary: 'researched', state: 'ca' },
  { name: 'New York — should now trigger NY blocker',   income: 150000, structure: 'llc_est', finances: 'clean', cpa: 'cpa', payroll: 'ready', salary: 'researched', state: 'ny' },
  { name: 'No state tax — should trigger NO state blocker', income: 150000, structure: 'llc_est', finances: 'clean', cpa: 'cpa', payroll: 'ready', salary: 'researched', state: 'notax' },
  { name: 'Negative income (invalid real-world input)', income: -20000, structure: 'llc_est', finances: 'clean', cpa: 'cpa', payroll: 'ready', salary: 'researched', state: 'notax' },
];

// Full combinatorial sweep across every discrete option, at a fixed mid-range
// income — cheap to run, catches anything the hand-picked cases miss.
const structures = ['sole', 'llc_new', 'llc_est', 'scorp', ''];
const financesOpts = ['mixed', 'basic', 'clean', ''];
const cpas = ['none', 'basic', 'cpa', ''];
const payrolls = ['none', 'researched', 'ready', ''];
const salaries = ['no', 'rough', 'researched', ''];
const states = ['ca', 'ny', 'notax', 'other', ''];

const combinatorialCases = [];
for (const structure of structures)
  for (const fin of financesOpts)
    for (const cpa of cpas)
      for (const payroll of payrolls)
        for (const salary of salaries)
          for (const state of states)
            combinatorialCases.push({
              name: `combo: structure=${structure||'∅'} finances=${fin||'∅'} cpa=${cpa||'∅'} payroll=${payroll||'∅'} salary=${salary||'∅'} state=${state||'∅'}`,
              income: 90000, structure, finances: fin, cpa, payroll, salary, state
            });

const allCases = [...boundaryCases, ...combinatorialCases];

// ─────────────────────────────────────────────
// Run
// ─────────────────────────────────────────────
console.log('═══════════════════════════════════════════════════════════');
console.log('MONETOOLS QA — S-Corp Readiness Assessment');
console.log('Testing file:', TARGET_FILE);
console.log(`Running ${allCases.length} cases (${boundaryCases.length} hand-picked + ${combinatorialCases.length} combinatorial)`);
console.log('═══════════════════════════════════════════════════════════\n');

let passCount = 0, failCount = 0;
const failures = [];

for (const tc of allCases) {
  let result, error = null;
  try {
    result = runCalcScore(TARGET_FILE, tc);
  } catch (e) {
    error = e.message;
  }

  const exp = expectedScores(tc);
  let status = 'PASS';
  const notes = [];

  if (error) {
    status = 'CRASH';
    notes.push('Tool threw an error: ' + error);
  } else {
    if (result.total !== exp.total) {
      status = 'FAIL';
      notes.push(`total score mismatch — tool: ${result.total}, expected: ${exp.total} (parts: ${JSON.stringify(exp.parts)})`);
    }
    if (result.stage !== exp.stage) {
      status = 'FAIL';
      notes.push(`stage mismatch — tool: "${result.stage}", expected: "${exp.stage}" (total=${result.total})`);
    }
    if (result.blockers.length !== exp.expectedBlockerCount) {
      status = 'FAIL';
      notes.push(`blocker count mismatch — tool returned ${result.blockers.length}, expected ${exp.expectedBlockerCount}`);
    }
    if (tc.income < 0) {
      if (result.inputInvalid !== true) {
        status = 'FAIL';
        notes.push('⚠ INPUT VALIDATION GAP: negative income did not set inputInvalid=true.');
      } else {
        notes.push('✓ Negative income correctly flagged via inputInvalid + a dedicated blocker.');
      }
    }
  }

  if (status === 'PASS') passCount++;
  else { failCount++; failures.push({ name: tc.name, status, notes }); }

  const isBoundaryCase = boundaryCases.includes(tc);
  if (isBoundaryCase || status !== 'PASS') {
    console.log(`[${status.padEnd(5)}] ${tc.name}`);
    if (!error) console.log(`         total=${result.total} stage=${result.stage} blockers=${result.blockers.length}`);
    notes.forEach(n => console.log('         ' + n));
    console.log('');
  }
}

console.log('═══════════════════════════════════════════════════════════');
console.log(`RESULT: ${passCount} passed cleanly, ${failCount} need human review (FAIL/CRASH/WARN)`);
if (failCount > 0) console.log(`(${failures.length} shown above — search for [FAIL], [CRASH], [WARN])`);
console.log('═══════════════════════════════════════════════════════════');
