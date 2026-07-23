const fs = require('fs');
const path = require('path');
const vm = require('vm');

const TARGET_FILE = process.argv[2] ||
  path.join(__dirname, '..', 'monetools_audit', 'Monetools', 'tools', 'landlords', 'asset-protection-calculator.html');

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
    'return { totalExposure, umbrellaCost, llcTotalAnnual, riskScore, verdictClass };\n}\n';
  return beforeFn + calcOnly;
}

function runCalc(htmlPath, d) {
  const source = extractTestableCalc(htmlPath);
  const sandbox = { document: { getElementById() { return { style: {}, innerHTML: '', scrollIntoView(){} }; } } };
  vm.createContext(sandbox);
  const runner = source + `
    d.numProperties = ${JSON.stringify(d.numProperties)};
    d.totalEquity = ${JSON.stringify(d.totalEquity)};
    d.outsideWorth = ${JSON.stringify(d.outsideWorth)};
    d.currentLiability = ${JSON.stringify(d.currentLiability)};
    d.hasSTR = ${JSON.stringify(d.hasSTR)};
    d.selfManage = ${JSON.stringify(d.selfManage)};
    d.stateType = ${JSON.stringify(d.stateType)};
    d.personalGuarantee = ${JSON.stringify(d.personalGuarantee)};
    var __qaResult = calcResult();
  `;
  vm.runInContext(runner, sandbox);
  return sandbox.__qaResult;
}

const LLC_ANNUAL_COST = { high: 1400, mid: 700, low: 350 };

function expectedResult(d) {
  const n = d.numProperties;
  const equity = d.totalEquity;
  const outside = d.outsideWorth;
  const totalExposure = equity + outside;

  let umbrellaCost = 250 + (Math.max(0, n-1) * 50);
  if (d.hasSTR === 'yes') umbrellaCost *= 1.4;
  umbrellaCost = Math.round(umbrellaCost);

  const llcAnnualPerEntity = LLC_ANNUAL_COST[d.stateType] || 700;
  const llcTotalAnnual = llcAnnualPerEntity * n;

  let riskScore = 0;
  if (d.hasSTR === 'yes') riskScore += 2;
  if (d.selfManage === 'yes') riskScore += 1;
  if (n >= 4) riskScore += 1;
  if (outside > 300000) riskScore += 1;
  if (totalExposure > 500000) riskScore += 1;
  if (d.personalGuarantee === 'yes') riskScore += 2;

  let verdictClass;
  if (n <= 2 && outside < 200000 && riskScore <= 2) verdictClass = 'green';
  else if (n >= 3 || totalExposure > 500000 || riskScore >= 4) verdictClass = 'blue';
  else verdictClass = 'yellow';

  return { totalExposure, umbrellaCost, llcTotalAnnual, riskScore, verdictClass };
}

const cases = [
  { name: '1 property, low risk — should be green', numProperties: 1, totalEquity: 100000, outsideWorth: 50000, currentLiability: 300000, hasSTR: 'no', selfManage: 'no', stateType: 'mid', personalGuarantee: 'no' },
  { name: '2 properties, low risk — should be green', numProperties: 2, totalEquity: 150000, outsideWorth: 100000, currentLiability: 300000, hasSTR: 'no', selfManage: 'no', stateType: 'mid', personalGuarantee: 'no' },
  { name: '3 properties, otherwise low risk — should now be blue (fixed threshold)', numProperties: 3, totalEquity: 200000, outsideWorth: 100000, currentLiability: 300000, hasSTR: 'no', selfManage: 'no', stateType: 'mid', personalGuarantee: 'no' },
  { name: '4 properties — should be blue', numProperties: 4, totalEquity: 300000, outsideWorth: 100000, currentLiability: 300000, hasSTR: 'no', selfManage: 'no', stateType: 'mid', personalGuarantee: 'no' },
  { name: 'High exposure regardless of property count — blue', numProperties: 1, totalEquity: 600000, outsideWorth: 100000, currentLiability: 300000, hasSTR: 'no', selfManage: 'no', stateType: 'mid', personalGuarantee: 'no' },
  { name: 'High risk score via STR + self-manage + guarantee — blue', numProperties: 2, totalEquity: 100000, outsideWorth: 50000, currentLiability: 300000, hasSTR: 'yes', selfManage: 'yes', stateType: 'mid', personalGuarantee: 'yes' },
  { name: 'Borderline yellow (2 properties, elevated outside assets)', numProperties: 2, totalEquity: 100000, outsideWorth: 250000, currentLiability: 300000, hasSTR: 'no', selfManage: 'yes', stateType: 'mid', personalGuarantee: 'no' },
  { name: 'High-cost state LLC (CA-equivalent "high" tier)', numProperties: 3, totalEquity: 300000, outsideWorth: 100000, currentLiability: 300000, hasSTR: 'no', selfManage: 'no', stateType: 'high', personalGuarantee: 'no' },
  { name: 'Low-cost state LLC (Wyoming-equivalent "low" tier)', numProperties: 3, totalEquity: 300000, outsideWorth: 100000, currentLiability: 300000, hasSTR: 'no', selfManage: 'no', stateType: 'low', personalGuarantee: 'no' },
  { name: 'Zero properties (edge case)', numProperties: 0, totalEquity: 0, outsideWorth: 50000, currentLiability: 0, hasSTR: 'no', selfManage: 'no', stateType: 'mid', personalGuarantee: 'no' },
];

console.log('═══════════════════════════════════════════════════════════');
console.log('MONETOOLS QA — LLC vs Umbrella Insurance Calculator');
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
    for (const field of ['umbrellaCost', 'llcTotalAnnual', 'riskScore']) {
      if (Math.round(result[field]) !== Math.round(exp[field])) {
        status = 'FAIL';
        notes.push(`${field} mismatch — tool: ${Math.round(result[field])}, expected: ${Math.round(exp[field])}`);
      }
    }
    if (result.verdictClass !== exp.verdictClass) {
      status = 'FAIL';
      notes.push(`verdictClass mismatch — tool: "${result.verdictClass}", expected: "${exp.verdictClass}"`);
    }
  }

  if (status === 'PASS') passCount++; else failCount++;

  console.log(`[${status.padEnd(5)}] ${tc.name}`);
  if (!error) {
    console.log(`         numProperties=${tc.numProperties}  totalExposure=${Math.round(result.totalExposure)}  riskScore=${result.riskScore}  verdict=${result.verdictClass}`);
  }
  notes.forEach(n => console.log('         ' + n));
  console.log('');
}

console.log('═══════════════════════════════════════════════════════════');
console.log(`RESULT: ${passCount} passed cleanly, ${failCount} need human review (FAIL/CRASH)`);
console.log('═══════════════════════════════════════════════════════════');
