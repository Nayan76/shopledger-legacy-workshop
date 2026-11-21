const test = require('node:test');
const assert = require('node:assert/strict');
const inventory = require('../lib/inventory');
const orders = require('../lib/orders');

const stockCases = [
  { stock: 1, reserved: 0, sellable: 1 },
  { stock: 4, reserved: 3, sellable: 1 },
  { stock: 5, reserved: 2, sellable: 3 },
  { stock: 4, reserved: 4, sellable: 0 }
];

for (const { stock, reserved, sellable } of stockCases) {
  test(`physical stock ${stock} with ${reserved} reserved leaves ${sellable} sellable`, () => {
    assert.equal(inventory.getSellableStock({ stock, reserved }), sellable);
  });
}

for (const { stock, reserved, sellable } of stockCases.filter(stockCase => stockCase.sellable > 0)) {
  test(`ordering the exact sellable quantity (${sellable}) succeeds with stock ${stock} and reserved ${reserved}`, () => {
    const products = [{ id: 1, name: 'Fixture product', stock, reserved }];

    assert.deepEqual(inventory.check(products, [{ id: 1, qty: sellable }]), { ok: true });
  });
}

test('ordering below sellable availability succeeds', () => {
  const products = [{ id: 1, stock: 5, reserved: 2 }];

  assert.deepEqual(inventory.check(products, [{ id: 1, qty: 2 }]), { ok: true });
});

test('ordering above sellable availability is rejected even when physical stock is sufficient', () => {
  const products = [{ id: 1, name: 'Fixture product', stock: 5, reserved: 2 }];

  assert.deepEqual(inventory.check(products, [{ id: 1, qty: 4 }]), {
    ok: false,
    msg: 'Fixture product is out of stock (3 sellable available)'
  });
});

test('cancelling a pending order with id-based lines restores physical and sellable stock', () => {
  const product = { id: 1, stock: 5, reserved: 2 };
  const db = { products: [product], orders: [], nextOrderId: 101 };
  const items = [{ id: 1, qty: 2 }];

  assert.deepEqual(inventory.check(db.products, items), { ok: true });
  inventory.reserve(db.products, items);
  assert.deepEqual(product, { id: 1, stock: 3, reserved: 2 });
  assert.equal(inventory.getSellableStock(product), 1);

  const order = orders.add(db, { date: '15/06/2024', status: 'pending', items });
  const result = orders.cancel(db, order.id, 'Fixture cancellation');

  assert.equal(result.ok, true);
  assert.strictEqual(result.order, db.orders[0]);
  assert.equal(order.status, 'cancelled');
  assert.equal(order.cancelReason, 'Fixture cancellation');
  assert.deepEqual(product, { id: 1, stock: 5, reserved: 2 });
  assert.equal(inventory.getSellableStock(product), 3);
});

test('release rejects productId-only lines without changing physical or reserved stock', () => {
  const product = { id: 1, stock: 4, reserved: 3 };

  const result = inventory.release([product], [{ productId: 1, qty: 2 }]);

  assert.equal(result.ok, false);
  assert.match(result.error, /product ID/);
  assert.deepEqual(product, { id: 1, stock: 4, reserved: 3 });
  assert.equal(inventory.getSellableStock(product), 1);
});

test('release preserves reserved stock even when restoring more units than are reserved', () => {
  const product = { id: 1, stock: 4, reserved: 1 };

  assert.deepEqual(inventory.release([product], [{ id: 1, qty: 2 }]), { ok: true });

  assert.deepEqual(product, { id: 1, stock: 6, reserved: 1 });
});
