/*
 * ═══════════════════════════════════════════════════════════
 * MONETOOLS QA — Automated Test Harness
 * Tool under test: tools/side-hustlers/quit-calculator.html
 * ═══════════════════════════════════════════════════════════
 * calcResult() reads several DOM inputs at the top and builds HTML with no
 * return — same "truncate before render + document stub" approach as the
 * other multi-step tools.
 *
 * Focus of these tests: the Social Security wage-base cap fix on the
 * "extra SE tax" line (previously applied 7.65% uncapped to the full
 * salary, overstating the safe-quit threshold for high earners).
 *
 * USAGE: node test-quit-calculator.js [path-to-html]
 * ═══════════════════════════════════════════════════════════
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const TARGET_FILE = process.argv[2] ||
  path.join(__dirname, '..', 'monetools_audit', 'Monetools', 'tools', 'side-hustlers', 'quit-calculator.html');

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
    'return { sal, benefitsValue, seExtraCost, trueReplacementAnnual, trueReplacementMonthly, safeQuitMonthly, gap, readinessPct, runwayOk, monthsToTarget, verdictClass };\n}\n';
  return beforeFn + calcOnly;
}

function runCalc(htmlPath, inputs) {
  const source = extractTestableCalc(htmlPath);
  const domValues = {
    'salary-input': inputs.salary, 'expenses-input': inputs.expenses,
    'current-income': inputs.currentIncome, 'runway-input': inputs.runway
  };
  const sandbox = {
    document: {
      getElementById(id) {
        if (id in domValues) return { value: String(domValues[id]) };
        return { style: {}, innerHTML: '', scrollIntoView(){} };
      }
    }
  };
  vm.createContext(sandbox);
  const runner = source + `
    d.benefits = ${JSON.stringify(inputs.benefits)};
    d.growth = ${JSON.stringify(inputs.growth)};
    var __qaResult = calcResult();
  `;
  vm.runInContext(runner, sandbox);
  return sandbox.__qaResult;
}

const SS_WAGE_BASE = 184500;

function expectedResult(inputs) {
  const sal = inputs.salary;
  let benefitsValue = 0;
  if (inputs.benefits.health) benefitsValue += 7200;
  if (inputs.benefits['401k']) benefitsValue += sal * 0.04;
  if (inputs.benefits.pto) benefitsValue += sal * 0.04;
  if (inputs.benefits.other) benefitsValue += 1800;

  const seExtraCost = Math.min(sal, SS_WAGE_BASE) * 0.062 + sal * 0.0145;
  const trueReplacementAnnual = sal + benefitsValue + seExtraCost;
  const trueReplacementMonthly = trueReplacementAnnual / 12;
  const safeQuitMonthly = trueReplacementMonthly * 1.25;
  const gap = Math.max(0, safeQuitMonthly - inputs.currentIncome);
  const readinessPct = Math.min(100, Math.round((inputs.currentIncome / safeQuitMonthly) * 100));

  return { seExtraCost, safeQuitMonthly, gap, readinessPct };
}

const cases = [
  { name: 'Typical salary, no benefits selected', salary: 70000, expenses: 3000, currentIncome: 4000, runway: 4, growth: 0.05, benefits: {health:false,'401k':false,pto:false,other:false} },
  { name: 'Typical salary, all benefits',          salary: 70000, expenses: 3000, currentIncome: 6000, runway: 6, growth: 0.05, benefits: {health:true,'401k':true,pto:true,other:true} },
  { name: 'High salary, above SS wage base',        salary: 300000, expenses: 8000, currentIncome: 25000, runway: 6, growth: 0.10, benefits: {health:true,'401k':true,pto:true,other:true} },
  { name: 'Salary exactly at SS wage base ($184,500)', salary: 184500, expenses: 6000, currentIncome: 15000, runway: 6, growth: 0.05, benefits: {health:true,'401k':true,pto:false,other:false} },
  { name: 'Salary just over SS wage base ($185,000)',  salary: 185000, expenses: 6000, currentIncome: 15000, runway: 6, growth: 0.05, benefits: {health:true,'401k':true,pto:false,other:false} },
  { name: 'Already ready to quit (green verdict)',   salary: 60000, expenses: 2500, currentIncome: 8000, runway: 8, growth: 0.05, benefits: {health:false,'401k':false,pto:false,other:false} },
  { name: 'Zero growth rate',                        salary: 60000, expenses: 2500, currentIncome: 2000, runway: 3, growth: 0, benefits: {health:true,'401k':false,pto:false,other:false} },
  { name: 'Zero current income',                     salary: 60000, expenses: 2500, currentIncome: 0, runway: 0, growth: 0.05, benefits: {health:false,'401k':false,pto:false,other:false} },
];

console.log('═══════════════════════════════════════════════════════════');
console.log('MONETOOLS QA — Side Hustle Quit Calculator');
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
    const exp = expectedResult(tc);
    if (Math.round(result.seExtraCost) !== Math.round(exp.seExtraCost)) {
      status = 'FAIL';
      notes.push(`seExtraCost mismatch — tool: ${Math.round(result.seExtraCost)}, expected (SS-capped): ${Math.round(exp.seExtraCost)}`);
    }
    if (Math.round(result.safeQuitMonthly) !== Math.round(exp.safeQuitMonthly)) {
      status = 'FAIL';
      notes.push(`safeQuitMonthly mismatch — tool: ${Math.round(result.safeQuitMonthly)}, expected: ${Math.round(exp.safeQuitMonthly)}`);
    }
    if (result.readinessPct !== exp.readinessPct) {
      status = 'FAIL';
      notes.push(`readinessPct mismatch — tool: ${result.readinessPct}, expected: ${exp.readinessPct}`);
    }
  }

  if (status === 'PASS') passCount++; else failCount++;

  console.log(`[${status.padEnd(5)}] ${tc.name}`);
  if (!error) {
    console.log(`         salary=$${tc.salary.toLocaleString()} currentIncome=$${tc.currentIncome.toLocaleString()}/mo`);
    console.log(`         seExtraCost=${Math.round(result.seExtraCost)}  safeQuitMonthly=${Math.round(result.safeQuitMonthly)}  readinessPct=${result.readinessPct}%`);
  }
  notes.forEach(n => console.log('         ' + n));
  console.log('');
}

console.log('═══════════════════════════════════════════════════════════');
console.log(`RESULT: ${passCount} passed cleanly, ${failCount} need human review (FAIL/CRASH)`);
console.log('═══════════════════════════════════════════════════════════');
