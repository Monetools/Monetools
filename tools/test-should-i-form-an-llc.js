/*
 * ═══════════════════════════════════════════════════════════
 * MONETOOLS QA — Automated Test Harness
 * Tool under test: tools/self-employed/should-i-form-an-llc.html
 * ═══════════════════════════════════════════════════════════
 * computeStage() and getRatings() are already pure functions (no DOM reads,
 * no HTML building) — this harness calls them directly.
 *
 * Also flags (informationally): getRatings() computes a full second weighted
 * "overallReadiness" scoring system (different weights than computeStage())
 * that is never displayed anywhere in showResult() — dead code, not a
 * wrong-number bug, but worth surfacing.
 *
 * USAGE: node test-should-i-form-an-llc.js [path-to-html]
 * ═══════════════════════════════════════════════════════════
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const TARGET_FILE = process.argv[2] ||
  path.join(__dirname, '..', 'monetools_audit', 'Monetools', 'tools', 'self-employed', 'should-i-form-an-llc.html');

function runTool(htmlPath, answers) {
  const html = fs.readFileSync(htmlPath, 'utf8');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  const target = scripts.find(s => s.includes('function computeStage'));
  if (!target) throw new Error('Could not find computeStage() — has the tool\'s structure changed?');

  const sandbox = {};
  vm.createContext(sandbox);
  const runner = target + `
    answers.income = ${JSON.stringify(answers.income)};
    answers.state = ${JSON.stringify(answers.state)};
    answers.business = ${JSON.stringify(answers.business)};
    answers.liability = ${JSON.stringify(answers.liability)};
    answers.finances = ${JSON.stringify(answers.finances)};
    answers.goal = ${JSON.stringify(answers.goal)};
    var __qaStage = computeStage();
    var __qaRatings = getRatings();
  `;
  vm.runInContext(runner, sandbox);
  return { stage: sandbox.__qaStage, ratings: sandbox.__qaRatings };
}

function expectedStage(a) {
  const incomeScore = Math.min(30, Math.max(0, (a.income / 250000) * 30));
  const liabilityScore = { low: 0, medium: 15, high: 30 }[a.liability] || 0;
  const businessScore = { hobby: 0, growing: 8, established: 16, agency: 20 }[a.business] || 0;
  const financesScore = { no: 0, partial: 5, yes: 10 }[a.finances] || 0;
  const stateScore = { no_tax: 10, mid: 6, ca: 0, ny: 0 }[a.state] ?? 6;
  const total = incomeScore + liabilityScore + businessScore + financesScore + stateScore;

  let stage;
  if (total <= 20) stage = 'stage1';
  else if (total <= 45) stage = 'stage2';
  else if (total <= 70) stage = 'stage3';
  else stage = 'stage4';
  return { stage, total };
}

const boundaryCases = [
  { name: 'Absolute minimum everything',  income: 0,      state: '', business: '',            liability: '',       finances: '',    goal: '' },
  { name: 'Absolute maximum everything',  income: 250000, state: '', business: 'agency',       liability: 'high',   finances: 'yes', goal: 'optimize' },
  { name: 'Income far above $250k (should still cap at 30 pts)', income: 5000000, state: '', business: 'agency', liability: 'high', finances: 'yes', goal: 'optimize' },
  { name: 'Right at stage1/stage2 boundary', income: 0, state: '', business: 'growing', liability: 'medium', finances: 'no', goal: 'grow' },
  { name: 'Right at stage2/stage3 boundary', income: 100000, state: '', business: 'growing', liability: 'medium', finances: 'partial', goal: 'grow' },
  { name: 'Right at stage3/stage4 boundary', income: 200000, state: '', business: 'established', liability: 'medium', finances: 'yes', goal: 'scale' },
  { name: 'High income but low everything else',  income: 250000, state: 'ca', business: 'hobby', liability: 'low', finances: 'no', goal: 'explore' },
  { name: 'Low income but high everything else',  income: 0,      state: 'ny', business: 'agency', liability: 'high', finances: 'yes', goal: 'optimize' },
];

const businesses = ['hobby', 'growing', 'established', 'agency', ''];
const liabilities = ['low', 'medium', 'high', ''];
const financesOpts = ['no', 'partial', 'yes', ''];
const goals = ['explore', 'grow', 'scale', 'optimize', ''];
const states = ['ca', 'ny', 'no_tax', 'mid', ''];

const combinatorialCases = [];
for (const business of businesses)
  for (const liability of liabilities)
    for (const finances of financesOpts)
      for (const goal of goals)
        for (const state of states)
          combinatorialCases.push({
            name: `combo: business=${business||'∅'} liability=${liability||'∅'} finances=${finances||'∅'} goal=${goal||'∅'} state=${state||'∅'}`,
            income: 80000, state, business, liability, finances, goal
          });

console.log('═══════════════════════════════════════════════════════════');
console.log('MONETOOLS QA — Should I Form an LLC? (Business Structure Assessment)');
console.log('Testing file:', TARGET_FILE);
console.log(`Running ${boundaryCases.length} hand-picked + ${combinatorialCases.length} combinatorial cases`);
console.log('═══════════════════════════════════════════════════════════\n');

let passCount = 0, failCount = 0;
const allCases = [...boundaryCases, ...combinatorialCases];

for (const tc of allCases) {
  let result, error = null;
  try {
    result = runTool(TARGET_FILE, tc);
  } catch (e) {
    error = e.message;
  }

  const exp = expectedStage(tc);
  let status = 'PASS';
  const notes = [];

  if (error) {
    status = 'CRASH';
    notes.push('Tool threw an error: ' + error);
  } else if (result.stage !== exp.stage) {
    status = 'FAIL';
    notes.push(`stage mismatch — tool: "${result.stage}", expected: "${exp.stage}" (total=${exp.total.toFixed(1)})`);
  }

  if (status === 'PASS') passCount++; else failCount++;

  const isBoundary = boundaryCases.includes(tc);
  if (isBoundary || status !== 'PASS') {
    console.log(`[${status.padEnd(5)}] ${tc.name}`);
    if (!error) console.log(`         stage=${result.stage}  (total=${exp.total.toFixed(1)}/100)`);
    notes.forEach(n => console.log('         ' + n));
    console.log('');
  }
}

console.log('═══════════════════════════════════════════════════════════');
console.log(`RESULT: ${passCount} passed cleanly, ${failCount} need human review (FAIL/CRASH)`);
console.log('');
console.log('ℹ NOTE (not a pass/fail check): getRatings() computes a second full');
console.log('  weighted score — liabilityReadiness/taxReadiness/bizReadiness/');
console.log('  adminReadiness/overallReadiness — using DIFFERENT weights than');
console.log('  computeStage(). None of these 5 fields are referenced anywhere in');
console.log('  showResult()\'s HTML output. Does not cause a wrong number on the');
console.log('  live page (it is never shown), but it is dead code worth a decision on.');
console.log('═══════════════════════════════════════════════════════════');
