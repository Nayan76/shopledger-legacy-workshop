const test = require('node:test');
const assert = require('node:assert/strict');
const dates = require('../lib/dates');
const orders = require('../lib/orders');
const ledger = require('../lib/ledger');

function historyFixture() {
  return {
    orders: [
      { id: 1001, date: '28/12/2021' },
      { id: 1004, date: '30/01/2022' },
      { id: 1008, date: '15/03/2022' }
    ]
  };
}

test('normalizeDateKey converts ISO date-only input to DD/MM/YYYY', () => {
  assert.equal(dates.normalizeDateKey('2022-03-15'), '15/03/2022');
  assert.equal(dates.normalizeDateKey('15/03/2022'), '15/03/2022');
});

test('order history sorts saved dates by year, month, and day', () => {
  const db = historyFixture();

  assert.deepEqual(orders.list(db).map(order => order.id), [1008, 1004, 1001]);
});

test('a cross-year range includes orders within its dates', () => {
  const filters = { from: '2021-12-28', to: '2022-03-15' };

  assert.deepEqual(orders.list(historyFixture(), filters).map(order => order.id), [1008, 1004, 1001]);
});

test('order history includes a same-day range with both supported boundary formats', () => {
  for (const boundary of ['15/03/2022', '2022-03-15']) {
    const result = orders.list(historyFixture(), { from: boundary, to: boundary });
    assert.deepEqual(result.map(order => order.id), [1008]);
  }
});

test('an end-only date filter excludes an order with no date', () => {
  const db = { orders: [{ id: 1 }, { id: 2, date: '10/03/2022' }] };

  const result = orders.list(db, { to: '2022-03-15' });

  assert.deepEqual(result.map(order => order.id), [2]);
});

test('sorting two same-date orders preserves their input order', () => {
  const db = { orders: [{ id: 2, date: '15/03/2022' }, { id: 1, date: '15/03/2022' }] };

  assert.deepEqual(orders.list(db).map(order => order.id), [2, 1]);
});

function khataFixture() {
  return {
    customers: [{
      id: 1,
      name: 'Fixture customer',
      openingBalance: 450,
      totalBilled: 1982.01,
      totalSettled: 1200,
      balance: 1232.01
    }],
    settlements: [],
    nextSettlementId: 51
  };
}

test('a string settlement adds to the cumulative total and records a numeric entry', () => {
  const db = khataFixture();

  const result = ledger.recordSettlement(db, 1, '500');

  assert.equal(result.ok, true);
  assert.equal(db.customers[0].totalSettled, 1700);
  assert.equal(db.customers[0].balance, 732.01);
  assert.equal(result.settlement.amount, 500);
  assert.equal(db.nextSettlementId, 52);
});

test('a numeric settlement increases the numeric total settled and reduces the balance', () => {
  const db = khataFixture();

  const result = ledger.recordSettlement(db, 1, 500);

  assert.equal(result.ok, true);
  assert.equal(db.customers[0].totalSettled, 1700);
  assert.equal(db.customers[0].balance, 732.01);
  assert.equal(result.settlement.amount, 500);
});

test('an unknown customer is rejected without changing the ledger', () => {
  const db = khataFixture();

  assert.deepEqual(ledger.recordSettlement(db, 999, 500), { ok: false, error: 'Customer not found' });
  assert.deepEqual(db, khataFixture());
});

for (const amount of [0, -500]) {
  test(`settlement amount ${amount} is rejected without changing the ledger`, () => {
    const db = khataFixture();

    assert.deepEqual(ledger.recordSettlement(db, 1, amount), {
      ok: false,
      error: 'Settlement amount must be greater than zero'
    });
    assert.deepEqual(db, khataFixture());
  });
}

test('a nonnumeric string settlement is rejected without changing the ledger', () => {
  const db = khataFixture();

  const result = ledger.recordSettlement(db, 1, 'invalid');

  assert.deepEqual(result, { ok: false, error: 'Settlement amount must be greater than zero' });
  assert.deepEqual(db, khataFixture());
});

test('a positive numeric payment can exceed the outstanding balance', () => {
  const db = khataFixture();

  const result = ledger.recordSettlement(db, 1, 1500);

  assert.equal(result.ok, true);
  assert.equal(db.customers[0].totalSettled, 2700);
  assert.equal(db.customers[0].balance, -267.99);
  assert.equal(result.settlement.amount, 1500);
});

test('consecutive successful settlements consume one ID each and prepend their entries', () => {
  const db = khataFixture();

  const first = ledger.recordSettlement(db, 1, 100);
  const second = ledger.recordSettlement(db, 1, 200);

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.deepEqual(db.settlements.map(({ id, amount }) => [id, amount]), [[52, 200], [51, 100]]);
  assert.equal(db.nextSettlementId, 53);
  assert.equal(db.customers[0].totalSettled, 1500);
  assert.equal(db.customers[0].balance, 932.01);
});
