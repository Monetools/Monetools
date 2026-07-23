const fs = require('fs');
const path = require('path');
const vm = require('vm');

const TARGET_FILE = process.argv[2] ||
  path.join(__dirname, '..', 'monetools_audit', 'Monetools', 'tools', 'landlords', 'sell-vs-keep-calculator.html');

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
    'return { accumDep, totalGain, recaptureGain, ltcgGain, ltcgRate, recaptureTax, ltcgTax, niitTax, totalTax, netProceeds, annualWealthBuilding, roe, altReturn, keepBetter, sellBetter };\n}\n';
  return beforeFn + calcOnly;
}

function runCalc(htmlPath, d) {
  const source = extractTestableCalc(htmlPath);
  const sandbox = { document: { getElementById() { return { style: {}, innerHTML: '', scrollIntoView(){} }; } } };
  vm.createContext(sandbox);
  const runner = source + `
    d.value = ${JSON.stringify(d.value)};
    d.mortgage = ${JSON.stringify(d.mortgage)};
    d.price = ${JSON.stringify(d.price)};
    d.years = ${JSON.stringify(d.years)};
    d.buildingPct = ${JSON.stringify(d.buildingPct)};
    d.rent = ${JSON.stringify(d.rent)};
    d.expenses = ${JSON.stringify(d.expenses)};
    d.filing = ${JSON.stringify(d.filing)};
    d.income = ${JSON.stringify(d.income)};
    d.appreciation = ${JSON.stringify(d.appreciation)};
    var __qaResult = calcResult();
  `;
  vm.runInContext(runner, sandbox);
  return sandbox.__qaResult;
}

const LTCG = {
  single:[[49450,0],[545500,.15],[Infinity,.20]],
  mfj:[[98900,0],[613700,.15],[Infinity,.20]],
  hoh:[[66200,0],[579600,.15],[Infinity,.20]]
};
const NIIT_T = { single:200000, mfj:250000, hoh:200000 };

function getLTCGRate(taxableIncome, filing) {
  for (const [lim, rate] of (LTCG[filing] || LTCG.single)) { if (taxableIncome <= lim) return rate; }
  return 0.20;
}

function expectedResult(d) {
  const sellCostPct = 0.07;
  const annualDep = (d.price * (d.buildingPct/100)) / 27.5;
  const accumDep = annualDep * d.years;

  const sellCosts = d.value * sellCostPct;
  const adjBasis = d.price - accumDep;
  const totalGain = Math.max(0, d.value - sellCosts - adjBasis);
  const recaptureGain = Math.min(accumDep, totalGain);
  const ltcgGain = Math.max(0, totalGain - recaptureGain);

  const ltcgRate = getLTCGRate(d.income + ltcgGain, d.filing);
  const recaptureTax = recaptureGain * 0.25;
  const ltcgTax = ltcgGain * ltcgRate;

  const magiWithSale = d.income + totalGain;
  let niitTax = 0;
  if (magiWithSale > NIIT_T[d.filing]) {
    const niitBase = Math.min(totalGain, magiWithSale - NIIT_T[d.filing]);
    niitTax = niitBase * 0.038;
  }
  const totalTax = recaptureTax + ltcgTax + niitTax;
  const netProceeds = d.value - sellCosts - d.mortgage - totalTax;

  const annualRentIncome = d.rent * 12;
  const annualCashFlow = annualRentIncome - d.expenses;
  const annualAppreciation = d.value * (d.appreciation || 0);
  const principalPaydown = d.mortgage * 0.02;
  const annualWealthBuilding = annualCashFlow + annualAppreciation + principalPaydown;
  const currentEquity = d.value - d.mortgage;
  const roe = currentEquity > 0 ? annualWealthBuilding / currentEquity : 0;
  const altReturn = netProceeds * 0.07;

  const keepBetter = annualWealthBuilding > altReturn * 1.1;
  const sellBetter = altReturn > annualWealthBuilding * 1.1;

  return { accumDep, totalGain, recaptureGain, ltcgGain, ltcgRate, recaptureTax, ltcgTax, niitTax, totalTax, netProceeds, annualWealthBuilding, roe, altReturn, keepBetter, sellBetter };
}

const cases = [
  { name: 'Typical sale with gain and moderate income', value: 450000, mortgage: 180000, price: 300000, years: 8, buildingPct: 80, rent: 2500, expenses: 1200, filing: 'single', income: 90000, appreciation: 0.03 },
  { name: 'Just under 0% LTCG threshold (single, low income)', value: 350000, mortgage: 100000, price: 250000, years: 5, buildingPct: 80, rent: 2000, expenses: 1000, filing: 'single', income: 20000, appreciation: 0.03 },
  { name: 'Just over 0% LTCG threshold', value: 500000, mortgage: 100000, price: 250000, years: 5, buildingPct: 80, rent: 2000, expenses: 1000, filing: 'single', income: 20000, appreciation: 0.03 },
  { name: 'Just under 15%/20% LTCG boundary (single, high income)', value: 900000, mortgage: 100000, price: 250000, years: 3, buildingPct: 80, rent: 3000, expenses: 1500, filing: 'single', income: 400000, appreciation: 0.03 },
  { name: 'High income crossing NIIT threshold', value: 900000, mortgage: 100000, price: 300000, years: 10, buildingPct: 80, rent: 4000, expenses: 2000, filing: 'single', income: 250000, appreciation: 0.03 },
  { name: 'Long ownership, high accumulated depreciation', value: 500000, mortgage: 50000, price: 200000, years: 27, buildingPct: 80, rent: 2500, expenses: 1200, filing: 'single', income: 80000, appreciation: 0.02 },
  { name: 'Depreciation exceeds total gain (recapture capped at gain)', value: 220000, mortgage: 50000, price: 200000, years: 27, buildingPct: 90, rent: 2000, expenses: 1000, filing: 'single', income: 60000, appreciation: 0.01 },
  { name: 'Underwater / low equity (ROE guard)', value: 200000, mortgage: 210000, price: 200000, years: 3, buildingPct: 80, rent: 1800, expenses: 1000, filing: 'single', income: 60000, appreciation: 0.02 },
  { name: 'No sale yet (0 years owned, 0 accumulated depreciation)', value: 300000, mortgage: 200000, price: 300000, years: 0, buildingPct: 80, rent: 2200, expenses: 1200, filing: 'single', income: 70000, appreciation: 0.03 },
  { name: 'MFJ, high value, strong keep case', value: 700000, mortgage: 100000, price: 300000, years: 5, buildingPct: 80, rent: 5000, expenses: 1500, filing: 'mfj', income: 120000, appreciation: 0.05 },
  { name: 'Zero appreciation assumption', value: 400000, mortgage: 150000, price: 300000, years: 5, buildingPct: 80, rent: 2500, expenses: 1500, filing: 'single', income: 80000, appreciation: 0 },
];

console.log('═══════════════════════════════════════════════════════════');
console.log('MONETOOLS QA — Sell vs Keep Calculator');
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
    for (const field of ['recaptureGain', 'ltcgGain', 'recaptureTax', 'ltcgTax', 'niitTax', 'totalTax', 'netProceeds', 'annualWealthBuilding', 'altReturn']) {
      if (Math.round(result[field]) !== Math.round(exp[field])) {
        status = 'FAIL';
        notes.push(`${field} mismatch — tool: ${Math.round(result[field])}, expected: ${Math.round(exp[field])}`);
      }
    }
    if (result.keepBetter !== exp.keepBetter || result.sellBetter !== exp.sellBetter) {
      status = 'FAIL';
      notes.push(`verdict mismatch — tool: keepBetter=${result.keepBetter} sellBetter=${result.sellBetter}, expected: keepBetter=${exp.keepBetter} sellBetter=${exp.sellBetter}`);
    }
  }

  if (status === 'PASS') passCount++; else failCount++;

  console.log(`[${status.padEnd(5)}] ${tc.name}`);
  if (!error) {
    console.log(`         totalGain=${Math.round(result.totalGain)}  recaptureGain=${Math.round(result.recaptureGain)}  totalTax=${Math.round(result.totalTax)}  netProceeds=${Math.round(result.netProceeds)}  keepBetter=${result.keepBetter} sellBetter=${result.sellBetter}`);
  }
  notes.forEach(n => console.log('         ' + n));
  console.log('');
}

console.log('═══════════════════════════════════════════════════════════');
console.log(`RESULT: ${passCount} passed cleanly, ${failCount} need human review (FAIL/CRASH)`);
console.log('═══════════════════════════════════════════════════════════');
