const fs = require('fs');
const path = require('path');
const vm = require('vm');

const TARGET_FILE = process.argv[2] ||
  path.join(__dirname, '..', 'monetools_audit', 'Monetools', 'tools', 'landlords', 'heloc-stress-test.html');

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
    'return { currentPayment, stressedRepayPayment, stressedPctOfIncome, cliffMultiple, verdictClass };\n}\n';
  return beforeFn + calcOnly;
}

function runCalc(htmlPath, d, ltvInput) {
  const source = extractTestableCalc(htmlPath);
  const sandbox = {
    document: {
      getElementById(id) {
        if (id === 'ltv-input') return { value: String(ltvInput || 0) };
        return { style: {}, innerHTML: '', scrollIntoView(){} };
      }
    }
  };
  vm.createContext(sandbox);
  const runner = source + `
    d.drawAmount = ${JSON.stringify(d.drawAmount)};
    d.currentRate = ${JSON.stringify(d.currentRate)};
    d.period = ${JSON.stringify(d.period)};
    d.drawYearsLeft = ${JSON.stringify(d.drawYearsLeft)};
    d.monthlyIncome = ${JSON.stringify(d.monthlyIncome)};
    d.purpose = ${JSON.stringify(d.purpose)};
    var __qaResult = calcResult();
  `;
  vm.runInContext(runner, sandbox);
  return sandbox.__qaResult;
}

function interestOnlyPayment(balance, rate) { return balance * (rate / 100) / 12; }
function amortizingPayment(balance, rate, years) {
  const r = (rate / 100) / 12;
  const n = years * 12;
  if (r === 0) return balance / n;
  return balance * (r * Math.pow(1+r, n)) / (Math.pow(1+r, n) - 1);
}

function expectedResult(d) {
  const balance = d.drawAmount;
  const rate = d.currentRate;
  const income = d.monthlyIncome;
  const isDrawPeriod = d.period === 'draw';
  const repaymentYears = 20;

  const currentPayment = isDrawPeriod ? interestOnlyPayment(balance, rate) : amortizingPayment(balance, rate, repaymentYears);
  const stressRate = rate + 2;
  const stressedRepayPayment = amortizingPayment(balance, stressRate, repaymentYears);
  const stressedPctOfIncome = income > 0 ? (stressedRepayPayment / income) * 100 : 0;
  const cliffMultiple = currentPayment > 0 ? (amortizingPayment(balance, rate, repaymentYears) / interestOnlyPayment(balance, rate)) : 0;

  let verdictClass;
  if (stressedPctOfIncome <= 5) verdictClass = 'green';
  else if (stressedPctOfIncome <= 8) verdictClass = 'yellow';
  else verdictClass = 'red';

  return { currentPayment, stressedRepayPayment, stressedPctOfIncome, cliffMultiple, verdictClass };
}

const cases = [
  { name: 'Draw period, comfortable income (green)', drawAmount: 50000, currentRate: 8, period: 'draw', drawYearsLeft: 5, monthlyIncome: 15000, purpose: 'renovation', ltv: 60 },
  { name: 'Draw period, tight income (yellow zone)', drawAmount: 100000, currentRate: 8, period: 'draw', drawYearsLeft: 3, monthlyIncome: 8000, purpose: 'debt_consolidation', ltv: 75 },
  { name: 'Draw period, very tight (red zone)', drawAmount: 150000, currentRate: 9, period: 'draw', drawYearsLeft: 2, monthlyIncome: 6000, purpose: 'market_investing', ltv: 85 },
  { name: 'Already in repayment period', drawAmount: 80000, currentRate: 7.5, period: 'repayment', drawYearsLeft: 0, monthlyIncome: 10000, purpose: 'rental_downpayment', ltv: 70 },
  { name: 'Exactly at 5% threshold boundary', drawAmount: 60000, currentRate: 6, period: 'draw', drawYearsLeft: 4, monthlyIncome: 20000, purpose: 'renovation', ltv: 50 },
  { name: 'Exactly at 8% threshold boundary', drawAmount: 120000, currentRate: 7, period: 'draw', drawYearsLeft: 2, monthlyIncome: 10000, purpose: 'renovation', ltv: 80 },
  { name: 'Zero rate edge case', drawAmount: 50000, currentRate: 0, period: 'draw', drawYearsLeft: 5, monthlyIncome: 10000, purpose: 'renovation', ltv: 60 },
  { name: 'Zero income (division guard)', drawAmount: 50000, currentRate: 8, period: 'draw', drawYearsLeft: 5, monthlyIncome: 0, purpose: 'renovation', ltv: 60 },
  { name: 'High LTV boundary (exactly 80%)', drawAmount: 70000, currentRate: 7.5, period: 'draw', drawYearsLeft: 3, monthlyIncome: 12000, purpose: 'renovation', ltv: 80 },
  { name: 'Very high draw amount', drawAmount: 500000, currentRate: 8.5, period: 'draw', drawYearsLeft: 1, monthlyIncome: 25000, purpose: 'market_investing', ltv: 90 },
];

console.log('═══════════════════════════════════════════════════════════');
console.log('MONETOOLS QA — HELOC Risk Stress Test');
console.log('Testing file:', TARGET_FILE);
console.log('═══════════════════════════════════════════════════════════\n');

let passCount = 0, failCount = 0;

for (const tc of cases) {
  let result, error = null;
  try { result = runCalc(TARGET_FILE, tc, tc.ltv); } catch (e) { error = e.message; }

  let status = 'PASS';
  const notes = [];

  if (error) {
    status = 'CRASH';
    notes.push('Tool threw an error: ' + error);
  } else {
    const exp = expectedResult(tc);
    for (const field of ['currentPayment', 'stressedRepayPayment', 'cliffMultiple']) {
      if (Math.abs(result[field] - exp[field]) > 1) {
        status = 'FAIL';
        notes.push(`${field} mismatch — tool: ${result[field].toFixed(2)}, expected: ${exp[field].toFixed(2)}`);
      }
    }
    if (Math.abs(result.stressedPctOfIncome - exp.stressedPctOfIncome) > 0.1) {
      status = 'FAIL';
      notes.push(`stressedPctOfIncome mismatch — tool: ${result.stressedPctOfIncome.toFixed(2)}, expected: ${exp.stressedPctOfIncome.toFixed(2)}`);
    }
    if (result.verdictClass !== exp.verdictClass) {
      status = 'FAIL';
      notes.push(`verdictClass mismatch — tool: "${result.verdictClass}", expected: "${exp.verdictClass}"`);
    }
  }

  if (status === 'PASS') passCount++; else failCount++;

  console.log(`[${status.padEnd(5)}] ${tc.name}`);
  if (!error) {
    console.log(`         currentPayment=${result.currentPayment.toFixed(0)}  stressedPctOfIncome=${result.stressedPctOfIncome.toFixed(1)}%  verdict=${result.verdictClass}  cliffMultiple=${result.cliffMultiple.toFixed(2)}x`);
  }
  notes.forEach(n => console.log('         ' + n));
  console.log('');
}

console.log('═══════════════════════════════════════════════════════════');
console.log(`RESULT: ${passCount} passed cleanly, ${failCount} need human review (FAIL/CRASH)`);
console.log('═══════════════════════════════════════════════════════════');
