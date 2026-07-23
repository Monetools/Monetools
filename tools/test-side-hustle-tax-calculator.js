/*
 * ═══════════════════════════════════════════════════════════
 * MONETOOLS QA — Automated Test Harness
 * Tool under test: tools/side-hustlers/side-hustle-tax-calculator.html
 * ═══════════════════════════════════════════════════════════
 * calcResult() reads DOM (expense input) at the top and builds HTML with no
 * return — same "truncate before render" approach as other multi-step tools.
 *
 * Good news found while reading the code: this tool's local TAX constants
 * (brackets, standard deduction, SS wage base) are already in sync with the
 * central config — no drift bug here, unlike quarterly-tax-estimator before
 * its fix.
 *
 * Suspected bug under test: ADD_MEDICARE_RATE/ADD_MEDICARE_SINGLE/
 * ADD_MEDICARE_MFJ are declared in the TAX constants object but never
 * referenced anywhere in the actual calculation — same "declared but
 * unused" pattern found 3 times already elsewhere in this audit.
 *
 * USAGE: node test-side-hustle-tax-calculator.js [path-to-html]
 * ═══════════════════════════════════════════════════════════
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const TARGET_FILE = process.argv[2] ||
  path.join(__dirname, '..', 'monetools_audit', 'Monetools', 'tools', 'side-hustlers', 'side-hustle-tax-calculator.html');

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
    'return { netSide, seTax: seTaxTotal, seTaxRegular: seTax, addlMedicareTax, seDeduction, qbiDed, extraIncomeTax, totalNewTax, takeHome, extraNeeded, marginalRate, effectiveRateOnSide };\n}\n';
  return beforeFn + calcOnly;
}

function runCalc(htmlPath, d, expensesInput) {
  const source = extractTestableCalc(htmlPath);
  const sandbox = {
    document: {
      getElementById(id) {
        if (id === 'exp-input') return { value: String(expensesInput || 0) };
        return { style: {}, innerHTML: '', scrollIntoView(){} };
      }
    }
  };
  vm.createContext(sandbox);
  const runner = source + `
    d.filing = ${JSON.stringify(d.filing)};
    d.w2 = ${JSON.stringify(d.w2)};
    d.withholding = ${JSON.stringify(d.withholding)};
    d.side = ${JSON.stringify(d.side)};
    var __qaResult = calcResult();
  `;
  vm.runInContext(runner, sandbox);
  return sandbox.__qaResult;
}

const BRACKETS = {
  single: [[12400,0.10],[50400,0.12],[105700,0.22],[201775,0.24],[256225,0.32],[640600,0.35],[Infinity,0.37]],
  mfj:    [[24800,0.10],[100800,0.12],[211400,0.22],[403550,0.24],[512450,0.32],[768700,0.35],[Infinity,0.37]],
  hoh:    [[18750,0.10],[50250,0.12],[100600,0.22],[176900,0.24],[229600,0.32],[640600,0.35],[Infinity,0.37]]
};
const STD_DED = { single: 16100, mfj: 32200, hoh: 24150 };
const SS_LIMIT = 184500, SS_RATE = 0.124, MEDICARE_RATE = 0.029;
const ADD_MEDICARE_RATE = 0.009;
const ADD_MEDICARE_THRESHOLD = { single: 200000, mfj: 250000, hoh: 200000 };
const QBI_PHASE = { single: 203000, mfj: 406000, hoh: 203000 };

function calcIncomeTax(ti, filing) {
  const b = BRACKETS[filing];
  let tax = 0, prev = 0;
  for (const [limit, rate] of b) {
    if (ti <= prev) break;
    tax += (Math.min(ti, limit) - prev) * rate;
    prev = limit;
  }
  return Math.max(0, tax);
}

function expectedResult(d, expenses) {
  const netSide = Math.max(0, d.side - expenses);
  const seBase = netSide * 0.9235;
  const seTax = Math.min(seBase, SS_LIMIT) * SS_RATE + seBase * MEDICARE_RATE;
  const combinedEarnings = d.w2 + seBase;
  const threshold = ADD_MEDICARE_THRESHOLD[d.filing] || ADD_MEDICARE_THRESHOLD.single;
  const addlMedicareTax = Math.max(0, combinedEarnings - threshold) * ADD_MEDICARE_RATE;
  const correctSeTax = seTax + addlMedicareTax;

  const seDeduction = seTax * 0.5;
  const stdDed = STD_DED[d.filing];
  const qbiPhaseout = QBI_PHASE[d.filing] || QBI_PHASE.single;
  const totalIncome = d.w2 + netSide - seDeduction;
  const qbiEligible = totalIncome < qbiPhaseout;
  const qbiDed = qbiEligible ? netSide * 0.20 : 0;

  const taxableW2only = Math.max(0, d.w2 - stdDed);
  const taxW2only = calcIncomeTax(taxableW2only, d.filing);
  const taxableWithSide = Math.max(0, d.w2 + netSide - seDeduction - qbiDed - stdDed);
  const taxWithSide = calcIncomeTax(taxableWithSide, d.filing);
  const extraIncomeTax = taxWithSide - taxW2only;

  return { netSide, seTax, correctSeTax, addlMedicareTax, extraIncomeTax };
}

const cases = [
  { name: 'Typical side hustler, low combined income', filing: 'single', w2: 60000, withholding: 8000, side: 15000, expenses: 2000 },
  { name: 'MFJ, moderate income',                       filing: 'mfj',    w2: 90000, withholding: 12000, side: 20000, expenses: 3000 },
  { name: 'High W-2 + side income (Addl Medicare zone, single)', filing: 'single', w2: 180000, withholding: 35000, side: 40000, expenses: 2000 },
  { name: 'High W-2 + side income (Addl Medicare zone, MFJ)',    filing: 'mfj',    w2: 220000, withholding: 45000, side: 50000, expenses: 3000 },
  { name: 'Very high combined income',                  filing: 'single', w2: 300000, withholding: 70000, side: 100000, expenses: 5000 },
  { name: 'Just under single Addl Medicare threshold',  filing: 'single', w2: 195000, withholding: 40000, side: 3000,  expenses: 0 },
  { name: 'Just over single Addl Medicare threshold',   filing: 'single', w2: 205000, withholding: 40000, side: 3000,  expenses: 0 },
  { name: 'Zero side income',                            filing: 'single', w2: 60000, withholding: 8000, side: 0, expenses: 0 },
  { name: 'Expenses exceed side income (net loss)',      filing: 'single', w2: 60000, withholding: 8000, side: 2000, expenses: 5000 },
];

console.log('═══════════════════════════════════════════════════════════');
console.log('MONETOOLS QA — Side Hustle Tax Calculator');
console.log('Testing file:', TARGET_FILE);
console.log('═══════════════════════════════════════════════════════════\n');

let passCount = 0, failCount = 0;

for (const tc of cases) {
  let result, error = null;
  try {
    result = runCalc(TARGET_FILE, tc, tc.expenses);
  } catch (e) {
    error = e.message;
  }

  let status = 'PASS';
  const notes = [];

  if (error) {
    status = 'CRASH';
    notes.push('Tool threw an error: ' + error);
  } else {
    const exp = expectedResult(tc, tc.expenses);
    if (Math.round(result.seTax) !== Math.round(exp.correctSeTax)) {
      status = 'FAIL';
      notes.push(`seTax mismatch — tool: ${Math.round(result.seTax)}, correct (incl. Addl Medicare): ${Math.round(exp.correctSeTax)}` +
        (exp.addlMedicareTax > 0 ? `  ⚠ Missing $${Math.round(exp.addlMedicareTax)} of Additional Medicare Tax (combined earnings exceed threshold).` : ''));
    }
    if (Math.round(result.extraIncomeTax) !== Math.round(exp.extraIncomeTax)) {
      status = 'FAIL';
      notes.push(`extraIncomeTax mismatch — tool: ${Math.round(result.extraIncomeTax)}, expected: ${Math.round(exp.extraIncomeTax)}`);
    }
  }

  if (status === 'PASS') passCount++; else failCount++;

  console.log(`[${status.padEnd(5)}] ${tc.name}`);
  if (!error) {
    console.log(`         filing=${tc.filing} w2=$${tc.w2.toLocaleString()} side=$${tc.side.toLocaleString()} expenses=$${tc.expenses.toLocaleString()}`);
    console.log(`         seTax=${Math.round(result.seTax)}  extraIncomeTax=${Math.round(result.extraIncomeTax)}  totalNewTax=${Math.round(result.totalNewTax)}`);
  }
  notes.forEach(n => console.log('         ' + n));
  console.log('');
}

console.log('═══════════════════════════════════════════════════════════');
console.log(`RESULT: ${passCount} passed cleanly, ${failCount} need human review (FAIL/CRASH)`);
console.log('═══════════════════════════════════════════════════════════');
