const fs = require('fs');
const path = require('path');
const vm = require('vm');

const TARGET_FILE = process.argv[2] ||
  path.join(__dirname, '..', 'monetools_audit', 'Monetools', 'tools', 'landlords', 'str-host-tax-tool.html');

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
    'return { hasSubstantial, net, seTaxIfC, vacationThreshold, isVacationHome, is14DayRule, shortStay, isScheduleC, strLoophole, verdictClass };\n}\n';
  return beforeFn + calcOnly;
}

function runCalc(htmlPath, d) {
  const source = extractTestableCalc(htmlPath);
  const sandbox = { document: { getElementById() { return { style: {}, innerHTML: '', scrollIntoView(){} }; } } };
  vm.createContext(sandbox);
  const runner = source + `
    d.rentedDays = ${JSON.stringify(d.rentedDays)};
    d.personalDays = ${JSON.stringify(d.personalDays)};
    d.avgStay = ${JSON.stringify(d.avgStay)};
    d.services = ${JSON.stringify(d.services)};
    d.income = ${JSON.stringify(d.income)};
    d.expenses = ${JSON.stringify(d.expenses)};
    d.material = ${JSON.stringify(d.material)};
    var __qaResult = calcResult();
  `;
  vm.runInContext(runner, sandbox);
  return sandbox.__qaResult;
}

function expectedResult(d) {
  const hasSubstantial = !!(d.services.sub1 || d.services.sub2 || d.services.sub3);
  const net = Math.max(0, d.income - d.expenses);
  const seBase = net * 0.9235;
  const seTaxIfC = Math.min(seBase, 184500) * 0.124 + seBase * 0.029;

  const vacationThreshold = Math.max(14, d.rentedDays * 0.10);
  const isVacationHome = d.personalDays > vacationThreshold;

  const is14DayRule = d.rentedDays <= 14 && d.personalDays > 14;
  const shortStay = (d.avgStay === '7less' || d.avgStay === 'unsure');
  const isScheduleC = hasSubstantial;
  const strLoophole = shortStay && d.material === 'yes' && !hasSubstantial;

  return { hasSubstantial, net, seTaxIfC, vacationThreshold, isVacationHome, is14DayRule, shortStay, isScheduleC, strLoophole };
}

const boundaryCases = [
  { name: '14-day rule qualifies exactly (14 rented, 15 personal)', rentedDays: 14, personalDays: 15, avgStay: '7less', services: {}, income: 8000, expenses: 500, material: 'no' },
  { name: '15 rented days — just breaks 14-day rule', rentedDays: 15, personalDays: 15, avgStay: '7less', services: {}, income: 8000, expenses: 500, material: 'no' },
  { name: '14 rented, exactly 14 personal (fails — needs >14)', rentedDays: 14, personalDays: 14, avgStay: '7less', services: {}, income: 8000, expenses: 500, material: 'no' },
  { name: 'Substantial services present — forces Schedule C', rentedDays: 200, personalDays: 10, avgStay: '7less', services: { sub1: true }, income: 60000, expenses: 15000, material: 'yes' },
  { name: 'No substantial services, short stay, material participation — STR loophole', rentedDays: 200, personalDays: 10, avgStay: '7less', services: {}, income: 60000, expenses: 15000, material: 'yes' },
  { name: 'Short stay but NOT materially participating — no loophole', rentedDays: 200, personalDays: 10, avgStay: '7less', services: {}, income: 60000, expenses: 15000, material: 'no' },
  { name: 'Material participation but long stays — no loophole (fails 7-day test)', rentedDays: 200, personalDays: 10, avgStay: '31plus', services: {}, income: 60000, expenses: 15000, material: 'yes' },
  { name: 'Vacation home threshold — exactly at boundary', rentedDays: 100, personalDays: 10, avgStay: '8to30', services: {}, income: 20000, expenses: 5000, material: 'no' }, // threshold = max(14,10)=14; personalDays=10 <=14, not vacation home
  { name: 'Vacation home — personal days exceed 10% threshold', rentedDays: 300, personalDays: 35, avgStay: '8to30', services: {}, income: 40000, expenses: 8000, material: 'no' }, // threshold=max(14,30)=30; personalDays=35>30 → vacation home
  { name: 'High income, Schedule E — SE tax avoided figure at SS wage base cap', rentedDays: 300, personalDays: 5, avgStay: '8to30', services: {}, income: 250000, expenses: 30000, material: 'no' },
  { name: 'Zero income',  rentedDays: 100, personalDays: 5, avgStay: '7less', services: {}, income: 0, expenses: 0, material: 'no' },
  { name: 'Expenses exceed income (net floored at 0)', rentedDays: 100, personalDays: 5, avgStay: '7less', services: {}, income: 5000, expenses: 12000, material: 'no' },
];

console.log('═══════════════════════════════════════════════════════════');
console.log('MONETOOLS QA — Airbnb Host Tax Classifier (STR Host Tax Tool)');
console.log('Testing file:', TARGET_FILE);
console.log('═══════════════════════════════════════════════════════════\n');

let passCount = 0, failCount = 0;

for (const tc of boundaryCases) {
  let result, error = null;
  try { result = runCalc(TARGET_FILE, tc); } catch (e) { error = e.message; }

  let status = 'PASS';
  const notes = [];

  if (error) {
    status = 'CRASH';
    notes.push('Tool threw an error: ' + error);
  } else {
    const exp = expectedResult(tc);
    for (const field of ['hasSubstantial', 'is14DayRule', 'isScheduleC', 'strLoophole', 'isVacationHome']) {
      if (!!result[field] !== !!exp[field]) {
        status = 'FAIL';
        notes.push(`${field} mismatch — tool: ${result[field]}, expected: ${exp[field]}`);
      }
    }
    if (Math.round(result.seTaxIfC) !== Math.round(exp.seTaxIfC)) {
      status = 'FAIL';
      notes.push(`seTaxIfC mismatch — tool: ${Math.round(result.seTaxIfC)}, expected: ${Math.round(exp.seTaxIfC)}`);
    }
  }

  if (status === 'PASS') passCount++; else failCount++;

  console.log(`[${status.padEnd(5)}] ${tc.name}`);
  if (!error) {
    console.log(`         is14DayRule=${result.is14DayRule}  isScheduleC=${result.isScheduleC}  strLoophole=${result.strLoophole}  isVacationHome=${result.isVacationHome}  seTaxIfC=${Math.round(result.seTaxIfC)}`);
  }
  notes.forEach(n => console.log('         ' + n));
  console.log('');
}

console.log('═══════════════════════════════════════════════════════════');
console.log(`RESULT: ${passCount} passed cleanly, ${failCount} need human review (FAIL/CRASH)`);
console.log('═══════════════════════════════════════════════════════════');
