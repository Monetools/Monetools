/*
 * ═══════════════════════════════════════════════════════════
 * MONETOOLS QA — Automated Test Harness
 * Tool under test: tools/self-employed/solo401k-calculator.html
 * ═══════════════════════════════════════════════════════════
 * Quirk specific to this tool: calcResult() computes everything AND builds
 * the result HTML in one function, with no return value — the numbers only
 * exist as local variables. This harness takes a copy of the extracted
 * function text and truncates it right before `const html = ...`, splicing
 * in a `return {...}` there instead — so we're still exercising the tool's
 * real calculation code, just stopping before the render step.
 *
 * USAGE: node test-solo401k-calculator.js [path-to-html]
 * ═══════════════════════════════════════════════════════════
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const TARGET_FILE = process.argv[2] ||
  path.join(__dirname, '..', 'monetools_audit', 'Monetools', 'tools', 'self-employed', 'solo401k-calculator.html');

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
  if (cutIndex === -1) throw new Error('Could not find the render boundary (`const html = ` ) — the tool\'s internal structure changed, this harness needs updating.');

  const calcOnly = fnAndAfter.slice(0, cutIndex) +
    'return { sepContribution, employeeDeferral, employerPortion, solo401kBase, solo401kTotal, catchUp, difference, extraTaxSavings, compBase, sepRate, assumedRate, isScorp };\n}\n';

  return beforeFn + calcOnly;
}

function runCalc(htmlPath, d, scorpSalaryInput) {
  const source = extractTestableCalc(htmlPath);
  const sandbox = {
    document: {
      getElementById(id) {
        if (id === 'scorp-salary') return { value: String(scorpSalaryInput || 0) };
        return { style: {}, innerHTML: '', scrollIntoView(){} };
      }
    }
  };
  vm.createContext(sandbox);
  const runner = source + `
    d.netIncome = ${JSON.stringify(d.netIncome)};
    d.age = ${JSON.stringify(d.age)};
    d.currentPlan = ${JSON.stringify(d.currentPlan)};
    d.structure = ${JSON.stringify(d.structure)};
    var __qaResult = calcResult();
  `;
  vm.runInContext(runner, sandbox);
  return sandbox.__qaResult;
}

const LIMITS = {
  employeeDeferral: 24500,
  combinedCap: 72000,
  catchUp5059: 8000,
  catchUp6063: 11250,
  sepEffectiveRate: 0.20,
  scorpEmployerRate: 0.25,
  compCap: 360000
};

function expectedCatchUp(age) {
  if (age >= 60 && age <= 63) return LIMITS.catchUp6063;
  if (age >= 50) return LIMITS.catchUp5059;
  return 0;
}

function expectedResult(d, scorpSalary) {
  const netIncome = d.netIncome;
  const age = d.age;
  const catchUp = expectedCatchUp(age);
  const isScorp = d.structure === 'scorp';
  const compBase = isScorp ? Math.min(scorpSalary, LIMITS.compCap) : Math.min(netIncome, LIMITS.compCap);

  const sepRate = isScorp ? LIMITS.scorpEmployerRate : LIMITS.sepEffectiveRate;
  let sepContribution = Math.max(0, Math.min(compBase * sepRate, LIMITS.combinedCap));

  const employeeDeferral = Math.min(LIMITS.employeeDeferral, compBase);
  const employerPortion = Math.min(compBase * sepRate, LIMITS.combinedCap - employeeDeferral);
  let solo401kBase = Math.min(employeeDeferral + Math.max(0, employerPortion), LIMITS.combinedCap);
  const solo401kTotal = solo401kBase + catchUp;

  const difference = solo401kTotal - sepContribution;

  return { sepContribution, employeeDeferral, employerPortion, solo401kTotal, difference, catchUp };
}

const cases = [
  { name: 'Sole prop, mid income, under 50',      netIncome: 100000, age: 40, currentPlan: 'none', structure: 'sole_prop', scorpSalary: 0 },
  { name: 'Sole prop, low income',                netIncome: 30000,  age: 35, currentPlan: 'none', structure: 'sole_prop', scorpSalary: 0 },
  { name: 'Sole prop, age 50-59 (catch-up)',      netIncome: 150000, age: 55, currentPlan: 'sep',  structure: 'sole_prop', scorpSalary: 0 },
  { name: 'Sole prop, age 60-63 (super catch-up)',netIncome: 150000, age: 61, currentPlan: 'sep',  structure: 'sole_prop', scorpSalary: 0 },
  { name: 'Sole prop, age 64 (catch-up expired)', netIncome: 150000, age: 64, currentPlan: 'sep',  structure: 'sole_prop', scorpSalary: 0 },
  { name: 'Sole prop, age exactly 49',            netIncome: 150000, age: 49, currentPlan: 'sep',  structure: 'sole_prop', scorpSalary: 0 },
  { name: 'Sole prop, age exactly 50',            netIncome: 150000, age: 50, currentPlan: 'sep',  structure: 'sole_prop', scorpSalary: 0 },
  { name: 'S-Corp, moderate salary',              netIncome: 150000, age: 40, currentPlan: 'none', structure: 'scorp', scorpSalary: 80000 },
  { name: 'S-Corp, very low salary (audit risk zone)', netIncome: 150000, age: 40, currentPlan: 'none', structure: 'scorp', scorpSalary: 20000 },
  { name: 'S-Corp, salary = 0',                   netIncome: 150000, age: 40, currentPlan: 'none', structure: 'scorp', scorpSalary: 0 },
  { name: 'Very high income (near comp cap)',     netIncome: 400000, age: 45, currentPlan: 'none', structure: 'sole_prop', scorpSalary: 0 },
  { name: 'At exactly comp cap ($360,000)',       netIncome: 360000, age: 45, currentPlan: 'none', structure: 'sole_prop', scorpSalary: 0 },
  { name: 'Zero net income',                      netIncome: 0,      age: 40, currentPlan: 'none', structure: 'sole_prop', scorpSalary: 0 },
];

console.log('═══════════════════════════════════════════════════════════');
console.log('MONETOOLS QA — Solo 401(k) vs SEP IRA Calculator');
console.log('Testing file:', TARGET_FILE);
console.log('═══════════════════════════════════════════════════════════\n');

let passCount = 0, failCount = 0;

for (const tc of cases) {
  let result, error = null;
  try {
    result = runCalc(TARGET_FILE, tc, tc.scorpSalary);
  } catch (e) {
    error = e.message;
  }

  let status = 'PASS';
  const notes = [];

  if (error) {
    status = 'CRASH';
    notes.push('Tool threw an error: ' + error);
  } else {
    const exp = expectedResult(tc, tc.scorpSalary);
    for (const field of ['sepContribution', 'employeeDeferral', 'solo401kTotal', 'difference', 'catchUp']) {
      if (Math.round(result[field]) !== Math.round(exp[field])) {
        status = 'FAIL';
        notes.push(`${field} mismatch — tool: ${Math.round(result[field])}, expected: ${Math.round(exp[field])}`);
      }
    }
  }

  if (status === 'PASS') passCount++; else failCount++;

  console.log(`[${status.padEnd(5)}] ${tc.name}`);
  if (!error) {
    console.log(`         netIncome=$${tc.netIncome.toLocaleString()} age=${tc.age} structure=${tc.structure} scorpSalary=$${tc.scorpSalary.toLocaleString()}`);
    console.log(`         sepContribution=${Math.round(result.sepContribution)}  solo401kTotal=${Math.round(result.solo401kTotal)}  difference=${Math.round(result.difference)}  catchUp=${result.catchUp}`);
  }
  notes.forEach(n => console.log('         ' + n));
  console.log('');
}

console.log('═══════════════════════════════════════════════════════════');
console.log(`RESULT: ${passCount} passed cleanly, ${failCount} need human review (FAIL/CRASH)`);
console.log('═══════════════════════════════════════════════════════════');
