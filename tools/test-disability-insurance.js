/*
 * ═══════════════════════════════════════════════════════════
 * MONETOOLS QA — Automated Test Harness
 * Tool under test: tools/self-employed/disability-insurance-calculator.html
 * ═══════════════════════════════════════════════════════════
 * Same "truncate before render, return the raw numbers" approach as the
 * Solo 401(k) harness, since calcResult() here also builds HTML directly
 * with no return value.
 *
 * Focus of these tests: the SSDI estimate must scale down proportionally
 * for low incomes instead of flooring at the national average — and the
 * displayed monthly gap must never be a fabricated positive number for a
 * low/zero income user.
 *
 * USAGE: node test-disability-insurance.js [path-to-html]
 * ═══════════════════════════════════════════════════════════
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const TARGET_FILE = process.argv[2] ||
  path.join(__dirname, '..', 'monetools_audit', 'Monetools', 'tools', 'self-employed', 'disability-insurance-calculator.html');

function extractTestableCalc(htmlPath) {
  const html = fs.readFileSync(htmlPath, 'utf8');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  const target = scripts.find(s => s.includes('function calcResult'));
  if (!target) throw new Error('Could not find calcResult() — has the tool\'s structure changed?');
  const fnStart = target.indexOf('function calcResult(');
  const beforeFn = target.slice(0, fnStart);
  const fnAndAfter = target.slice(fnStart);
  const cutMarker = 'const html = `';
  const cutIndex = fnAndAfter.indexOf(cutMarker);
  if (cutIndex === -1) throw new Error('Could not find the render boundary — tool structure changed, harness needs updating.');
  const calcOnly = fnAndAfter.slice(0, cutIndex) +
    'return { annualIncome, monthlyIncome, estimatedSSDI, monthlyGap, expenseGap, recommendedPolicyLow, recommendedPolicyHigh, premiumLow, premiumHigh, verdictClass };\n}\n';
  return beforeFn + calcOnly;
}

function runCalc(htmlPath, d) {
  const source = extractTestableCalc(htmlPath);
  const sandbox = {};
  vm.createContext(sandbox);
  const runner = source + `
    d.netIncome = ${JSON.stringify(d.netIncome)};
    d.ssdiEligible = ${JSON.stringify(d.ssdiEligible)};
    d.monthlyExpenses = ${JSON.stringify(d.monthlyExpenses)};
    d.monthsSavings = ${JSON.stringify(d.monthsSavings)};
    d.occType = ${JSON.stringify(d.occType)};
    var __qaResult = calcResult();
  `;
  vm.runInContext(runner, sandbox);
  return sandbox.__qaResult;
}

const SSDI_AVERAGE_MONTHLY = 1630;
const SSDI_MAX_MONTHLY = 4152;

function expectedSSDI(annualIncome, ssdiEligible) {
  if (ssdiEligible === 'no') return 0;
  let est;
  if (annualIncome <= 40000) {
    est = SSDI_AVERAGE_MONTHLY * Math.max(0, annualIncome / 40000);
  } else {
    const scaleFactor = Math.min(1, (annualIncome - 40000) / 110000);
    est = SSDI_AVERAGE_MONTHLY + (SSDI_MAX_MONTHLY - SSDI_AVERAGE_MONTHLY) * scaleFactor * 0.6;
  }
  return Math.min(est, SSDI_MAX_MONTHLY);
}

const cases = [
  { name: 'Zero income',                  netIncome: 0,      ssdiEligible: 'yes', monthlyExpenses: 1500, monthsSavings: 3, occType: 'desk' },
  { name: 'Very low income ($5,000/yr)',  netIncome: 5000,   ssdiEligible: 'yes', monthlyExpenses: 2000, monthsSavings: 3, occType: 'desk' },
  { name: 'Low income ($20,000/yr)',      netIncome: 20000,  ssdiEligible: 'yes', monthlyExpenses: 2000, monthsSavings: 3, occType: 'desk' },
  { name: 'Just under $40k boundary',     netIncome: 39999,  ssdiEligible: 'yes', monthlyExpenses: 2500, monthsSavings: 3, occType: 'desk' },
  { name: 'Just over $40k boundary',      netIncome: 40001,  ssdiEligible: 'yes', monthlyExpenses: 2500, monthsSavings: 3, occType: 'desk' },
  { name: 'Mid income ($80,000/yr)',      netIncome: 80000,  ssdiEligible: 'yes', monthlyExpenses: 4000, monthsSavings: 6, occType: 'specialized' },
  { name: 'High income ($200,000/yr)',    netIncome: 200000, ssdiEligible: 'yes', monthlyExpenses: 8000, monthsSavings: 12, occType: 'physical' },
  { name: 'Very high income (near/above max scaling)', netIncome: 500000, ssdiEligible: 'yes', monthlyExpenses: 15000, monthsSavings: 12, occType: 'desk' },
  { name: 'Not SSDI eligible',            netIncome: 80000,  ssdiEligible: 'no',  monthlyExpenses: 4000, monthsSavings: 6, occType: 'desk' },
];

console.log('═══════════════════════════════════════════════════════════');
console.log('MONETOOLS QA — Disability Insurance Calculator');
console.log('Testing file:', TARGET_FILE);
console.log('═══════════════════════════════════════════════════════════\n');

let passCount = 0, failCount = 0;

for (const tc of cases) {
  let result, error = null;
  try { result = runCalc(TARGET_FILE, tc); } catch (e) { error = e.message; }

  let status = 'PASS';
  const notes = [];

  if (error) {
    status = 'CRASH';
    notes.push('Tool threw an error: ' + error);
  } else {
    const expSSDI = expectedSSDI(tc.netIncome, tc.ssdiEligible);
    if (Math.round(result.estimatedSSDI) !== Math.round(expSSDI)) {
      status = 'FAIL';
      notes.push(`estimatedSSDI mismatch — tool: ${Math.round(result.estimatedSSDI)}, expected: ${Math.round(expSSDI)}`);
    }
    if (tc.netIncome <= 40000 && tc.ssdiEligible !== 'no' && result.monthlyGap < -0.01) {
      status = 'FAIL';
      notes.push(`⚠ Displayed gap would be fabricated: raw monthlyGap=${result.monthlyGap.toFixed(2)} is negative, but fmt() strips the sign — this would show a positive dollar "gap" for someone whose SSDI estimate exceeds their real income.`);
    }
    if (tc.netIncome === 0 && Math.round(result.estimatedSSDI) !== 0) {
      status = 'FAIL';
      notes.push('Zero income should produce a $0 SSDI estimate, not a positive one.');
    }
  }

  if (status === 'PASS') passCount++; else failCount++;

  console.log(`[${status.padEnd(5)}] ${tc.name}`);
  if (!error) {
    console.log(`         annualIncome=$${tc.netIncome.toLocaleString()}  estimatedSSDI=$${Math.round(result.estimatedSSDI).toLocaleString()}/mo  monthlyGap=${Math.round(result.monthlyGap)}`);
  }
  notes.forEach(n => console.log('         ' + n));
  console.log('');
}

console.log('═══════════════════════════════════════════════════════════');
console.log(`RESULT: ${passCount} passed cleanly, ${failCount} need human review (FAIL/CRASH)`);
console.log('═══════════════════════════════════════════════════════════');
