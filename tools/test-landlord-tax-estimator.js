const fs = require('fs');
const path = require('path');
const vm = require('vm');

const TARGET_FILE = process.argv[2] ||
  path.join(__dirname, '..', 'monetools_audit', 'Monetools', 'tools', 'landlords', 'landlord-tax-estimator.html');

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
    'return { annualRent, totalOpEx, annualDepreciation, netScheduleE, marginalRate, taxOwed, niitOwed, deductibleLoss, suspendedLoss, allowance, scenario, cashFlow };\n}\n';
  return beforeFn + calcOnly;
}

function runCalc(htmlPath, d, expenses) {
  const source = extractTestableCalc(htmlPath);
  const domValues = {
    'exp-interest': expenses.interest, 'exp-proptax': expenses.proptax, 'exp-insurance': expenses.insurance,
    'exp-repairs': expenses.repairs, 'exp-mgmt': expenses.mgmt || 0, 'exp-other': expenses.other || 0
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
    d.rent = ${JSON.stringify(d.rent)};
    d.vacancyMonths = ${JSON.stringify(d.vacancyMonths)};
    d.price = ${JSON.stringify(d.price)};
    d.buildingPct = ${JSON.stringify(d.buildingPct)};
    d.claiming = ${JSON.stringify(d.claiming)};
    d.filing = ${JSON.stringify(d.filing)};
    d.magi = ${JSON.stringify(d.magi)};
    d.active = ${JSON.stringify(d.active)};
    var __qaResult = calcResult();
  `;
  vm.runInContext(runner, sandbox);
  return sandbox.__qaResult;
}

const BRACKETS = {
  single:[[12400,.10],[50400,.12],[105700,.22],[201775,.24],[256225,.32],[640600,.35],[Infinity,.37]],
  mfj:[[24800,.10],[100800,.12],[211400,.22],[403550,.24],[512450,.32],[768700,.35],[Infinity,.37]],
  hoh:[[18750,.10],[50250,.12],[100600,.22],[176900,.24],[229600,.32],[640600,.35],[Infinity,.37]]
};
const STD_DED = { single:16100, mfj:32200, hoh:24150 };
const NIIT_THRESHOLD = { single:200000, mfj:250000, hoh:200000 };

function getMarginal(taxable, filing) {
  const b = BRACKETS[filing] || BRACKETS.single;
  for (const [lim, rate] of b) { if (taxable <= lim) return rate; }
  return 0.37;
}

function expectedResult(d, expenses) {
  const annualRent = d.rent * (12 - d.vacancyMonths);
  const totalOpEx = expenses.interest + expenses.proptax + expenses.insurance + expenses.repairs + (expenses.mgmt||0) + (expenses.other||0);
  const depreciableBasis = d.price * (d.buildingPct / 100);
  const annualDepreciation = depreciableBasis / 27.5;
  const netScheduleE = annualRent - totalOpEx - annualDepreciation;
  const marginalRate = getMarginal(Math.max(0, d.magi - STD_DED[d.filing]), d.filing);

  let taxOwed = 0, niitOwed = 0, deductibleLoss = 0, suspendedLoss = 0, allowance = 0, scenario = '';

  if (netScheduleE > 0) {
    scenario = 'income';
    taxOwed = netScheduleE * marginalRate;
    const totalMAGI = d.magi + netScheduleE;
    if (totalMAGI > NIIT_THRESHOLD[d.filing]) {
      const niitBase = Math.min(netScheduleE, totalMAGI - NIIT_THRESHOLD[d.filing]);
      niitOwed = niitBase * 0.038;
    }
  } else if (netScheduleE < 0) {
    const loss = Math.abs(netScheduleE);
    if (d.active === 'yes') {
      if (d.magi <= 100000) allowance = 25000;
      else if (d.magi < 150000) allowance = 25000 - (d.magi - 100000) * 0.5;
      else allowance = 0;
      deductibleLoss = Math.min(loss, allowance);
      suspendedLoss = loss - deductibleLoss;
      scenario = deductibleLoss > 0 ? 'deductible-loss' : 'suspended-loss';
    } else {
      suspendedLoss = loss;
      scenario = 'suspended-loss';
    }
  } else {
    scenario = 'breakeven';
  }

  return { annualDepreciation, netScheduleE, marginalRate, taxOwed, niitOwed, deductibleLoss, suspendedLoss, allowance, scenario };
}

const cases = [
  { name: 'Clear rental income scenario', rent: 3000, vacancyMonths: 0, price: 250000, buildingPct: 80, claiming: 'yes', filing: 'single', magi: 90000, active: 'yes', expenses: { interest: 8000, proptax: 3000, insurance: 1500, repairs: 1000 } },
  { name: 'Clear loss scenario, fully deductible', rent: 1800, vacancyMonths: 1, price: 300000, buildingPct: 80, claiming: 'yes', filing: 'single', magi: 70000, active: 'yes', expenses: { interest: 12000, proptax: 4000, insurance: 1800, repairs: 3000 } },
  { name: 'Loss, MAGI exactly at $100,000 (full allowance)', rent: 2000, vacancyMonths: 0, price: 300000, buildingPct: 80, claiming: 'yes', filing: 'single', magi: 100000, active: 'yes', expenses: { interest: 15000, proptax: 4000, insurance: 1800, repairs: 3000 } },
  { name: 'Loss, MAGI at $125,000 (mid-phase-out, allowance=$12,500)', rent: 2000, vacancyMonths: 0, price: 300000, buildingPct: 80, claiming: 'yes', filing: 'single', magi: 125000, active: 'yes', expenses: { interest: 15000, proptax: 4000, insurance: 1800, repairs: 3000 } },
  { name: 'Loss, MAGI just under $150,000 (allowance near $0)', rent: 2000, vacancyMonths: 0, price: 300000, buildingPct: 80, claiming: 'yes', filing: 'single', magi: 149999, active: 'yes', expenses: { interest: 15000, proptax: 4000, insurance: 1800, repairs: 3000 } },
  { name: 'Loss, MAGI exactly $150,000 (allowance=$0, fully suspended)', rent: 2000, vacancyMonths: 0, price: 300000, buildingPct: 80, claiming: 'yes', filing: 'single', magi: 150000, active: 'yes', expenses: { interest: 15000, proptax: 4000, insurance: 1800, repairs: 3000 } },
  { name: 'Loss, MAGI above $150,000 (fully suspended)', rent: 2000, vacancyMonths: 0, price: 300000, buildingPct: 80, claiming: 'yes', filing: 'single', magi: 200000, active: 'yes', expenses: { interest: 15000, proptax: 4000, insurance: 1800, repairs: 3000 } },
  { name: 'Loss, not actively participating (fully suspended regardless of MAGI)', rent: 2000, vacancyMonths: 0, price: 300000, buildingPct: 80, claiming: 'yes', filing: 'single', magi: 50000, active: 'no', expenses: { interest: 15000, proptax: 4000, insurance: 1800, repairs: 3000 } },
  { name: 'Income scenario, NIIT threshold crossed (single)', rent: 8000, vacancyMonths: 0, price: 500000, buildingPct: 80, claiming: 'yes', filing: 'single', magi: 195000, active: 'yes', expenses: { interest: 10000, proptax: 5000, insurance: 2000, repairs: 2000 } },
  { name: 'Income scenario, well under NIIT threshold', rent: 3000, vacancyMonths: 0, price: 250000, buildingPct: 80, claiming: 'yes', filing: 'single', magi: 60000, active: 'yes', expenses: { interest: 6000, proptax: 3000, insurance: 1500, repairs: 1000 } },
  { name: 'Breakeven scenario (net exactly $0)', rent: 2000, vacancyMonths: 0, price: 0, buildingPct: 80, claiming: 'no', filing: 'single', magi: 60000, active: 'yes', expenses: { interest: 12000, proptax: 8000, insurance: 4000 } },
  { name: 'Full year vacancy', rent: 2000, vacancyMonths: 12, price: 250000, buildingPct: 80, claiming: 'yes', filing: 'single', magi: 60000, active: 'yes', expenses: { interest: 8000, proptax: 3000, insurance: 1500, repairs: 1000 } },
  { name: 'MFJ high income, income scenario', rent: 10000, vacancyMonths: 0, price: 700000, buildingPct: 85, claiming: 'yes', filing: 'mfj', magi: 300000, active: 'yes', expenses: { interest: 20000, proptax: 8000, insurance: 3000, repairs: 3000 } },
];

console.log('═══════════════════════════════════════════════════════════');
console.log('MONETOOLS QA — Landlord Tax Estimator');
console.log('Testing file:', TARGET_FILE);
console.log('═══════════════════════════════════════════════════════════\n');

let passCount = 0, failCount = 0;

for (const tc of cases) {
  let result, error = null;
  try { result = runCalc(TARGET_FILE, tc, tc.expenses); } catch (e) { error = e.message; }

  let status = 'PASS';
  const notes = [];

  if (error) {
    status = 'CRASH';
    notes.push('Tool threw an error: ' + error);
  } else {
    const exp = expectedResult(tc, tc.expenses);
    for (const field of ['taxOwed', 'niitOwed', 'deductibleLoss', 'suspendedLoss', 'allowance']) {
      if (Math.round(result[field]) !== Math.round(exp[field])) {
        status = 'FAIL';
        notes.push(`${field} mismatch — tool: ${Math.round(result[field])}, expected: ${Math.round(exp[field])}`);
      }
    }
    if (result.scenario !== exp.scenario) {
      status = 'FAIL';
      notes.push(`scenario mismatch — tool: "${result.scenario}", expected: "${exp.scenario}"`);
    }
  }

  if (status === 'PASS') passCount++; else failCount++;

  console.log(`[${status.padEnd(5)}] ${tc.name}`);
  if (!error) {
    console.log(`         netScheduleE=${Math.round(result.netScheduleE)}  scenario=${result.scenario}  allowance=${Math.round(result.allowance)}  deductibleLoss=${Math.round(result.deductibleLoss)}  suspendedLoss=${Math.round(result.suspendedLoss)}  niitOwed=${Math.round(result.niitOwed)}`);
  }
  notes.forEach(n => console.log('         ' + n));
  console.log('');
}

console.log('═══════════════════════════════════════════════════════════');
console.log(`RESULT: ${passCount} passed cleanly, ${failCount} need human review (FAIL/CRASH)`);
console.log('═══════════════════════════════════════════════════════════');
