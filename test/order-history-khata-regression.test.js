const test = require('node:test');
const assert = require('node:assert/strict');
const dates = require('../lib/dates');
const orders = require('../lib/orders');
const ledger = require('../lib/ledger');

function history() {
  return { orders: [
    { id: 1001, date: '28/12/2021' },
    { id: 1004, date: '30/01/2022' },
    { id: 1008, date: '15/03/2022' }
  ] };
}

test('order history sorts the reported dates newest first', () => {
  assert.deepEqual(orders.list(history()).map(order => order.id), [1008, 1004, 1001]);
});

for (const [from, to] of [['2021-12-28', '2022-03-15'], ['28/12/2021', '15/03/2022']]) {
  test(`order history includes both boundaries and excludes outside dates for ${from} through ${to}`, () => {
    const db = history();
    db.orders.push({ id: 1, date: '27/12/2021' }, { id: 2, date: '16/03/2022' });

    assert.deepEqual(orders.list(db, { from, to }).map(order => order.id), [1008, 1004, 1001]);
  });
}

test('equal dates preserve input order across both saved formats', () => {
  const db = { orders: [
    { id: 3, date: '15/03/2022' }, { id: 1, date: '15/03/2022' }, { id: 2, date: '2022-03-15' }
  ] };

  assert.deepEqual(orders.list(db).map(order => order.id), [3, 1, 2]);
});

test('undated and malformed orders appear last without a date filter', () => {
  const db = { orders: [
    { id: 1 }, { id: 2, date: '31/02/2022' }, { id: 3, date: '15/03/2022' }
  ] };

  assert.deepEqual(orders.list(db).map(order => order.id), [3, 1, 2]);
});

test('an end-only filter excludes missing and malformed saved dates', () => {
  const db = { orders: [
    { id: 1 }, { id: 2, date: '10/02/2022' }, { id: 3, date: '10/00/2022' }
  ] };

  assert.deepEqual(orders.list(db, { to: '2022-03-15' }).map(order => order.id), [2]);
});

for (const [description, filters, message] of [
  ['invalid start date', { from: '2022-02-29' }, /invalid start date/i],
  ['invalid end date', { to: '31/04/2022' }, /invalid end date/i],
  ['ambiguous input', { from: '03-04-2022' }, /invalid start date/i],
  ['reversed range', { from: '2022-03-15', to: '28/12/2021' }, /start date.*after.*end date/i]
]) {
  test(`order history rejects ${description} with a validation error`, () => {
    assert.throws(() => orders.list(history(), filters), message);
  });
}

test('a valid leap day is included and the fiscal year helper keeps its existing format', () => {
  const db = { orders: [{ id: 1, date: '29/02/2024' }] };

  assert.deepEqual(orders.list(db, { from: '2024-02-29', to: '2024-02-29' }), db.orders);
  assert.equal(dates.getFiscalYear('2024-02-29'), 'FY23-24');
  assert.equal(dates.getFiscalYear('01/04/2024'), 'FY24-25');
});

function account(totalSettled = 1200) {
  return {
    customers: [{ id: 1, name: 'Fixture customer', openingBalance: 450, totalBilled: 1982.01, totalSettled }],
    settlements: [],
    nextSettlementId: 51
  };
}

test('a string settlement gives the same result as a numeric settlement', () => {
  const stringDb = account();
  const numericDb = account();
  const stringResult = ledger.recordSettlement(stringDb, 1, '500');
  const numericResult = ledger.recordSettlement(numericDb, 1, 500);

  assert.equal(stringResult.ok, true);
  assert.equal(numericResult.ok, true);
  assert.equal(stringDb.customers[0].totalSettled, 1700);
  assert.equal(stringDb.customers[0].balance, 732.01);
  assert.equal(stringResult.settlement.amount, 500);
  assert.equal(Number.isFinite(stringResult.settlement.amount), true);
  assert.deepEqual(stringDb.customers, numericDb.customers);
});

test('consecutive settlements accumulate numerically from a numeric-string prior total', () => {
  const db = account('1200');

  assert.equal(ledger.recordSettlement(db, 1, 500).ok, true);
  assert.equal(ledger.recordSettlement(db, 1, '250.25').ok, true);
  assert.equal(db.customers[0].totalSettled, 1950.25);
  assert.equal(db.customers[0].balance, 481.76);
  assert.deepEqual(db.settlements.map(entry => [entry.id, entry.amount]), [[52, 250.25], [51, 500]]);
  assert.equal(db.nextSettlementId, 53);
});

for (const amount of ['invalid', NaN, Infinity, 0, -500]) {
  test(`settlement rejects ${String(amount)} and preserves customer data, entries, and next ID`, () => {
    const db = account();
    db.settlements.push({ id: 50, amount: 200 });
    const before = structuredClone(db);

    assert.equal(ledger.recordSettlement(db, 1, amount).ok, false);
    assert.deepEqual(db, before);
  });
}

test('positive overpayment remains allowed and creates a negative balance', () => {
  const db = account();
  const result = ledger.recordSettlement(db, 1, 1500);

  assert.equal(result.ok, true);
  assert.equal(db.customers[0].totalSettled, 2700);
  assert.equal(db.customers[0].balance, -267.99);
});
