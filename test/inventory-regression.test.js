const test = require('node:test');
const assert = require('node:assert/strict');
const inventory = require('../lib/inventory');
const orders = require('../lib/orders');

for (const [stock, reserved, qty] of [[1, 0, 1], [4, 3, 1], [5, 2, 3]]) {
  test(`checkout accepts quantity ${qty} with stock ${stock} and reserved ${reserved}`, () => {
    const product = { id: 1, name: 'Fixture product', stock, reserved };
    const items = [{ id: 1, qty }];

    assert.equal(inventory.check([product], items).ok, true);
    inventory.reserve([product], items);

    assert.equal(product.stock, stock - qty);
    assert.equal(product.reserved, reserved);
    assert.equal(inventory.getSellableStock(product), 0);
  });
}

test('checkout rejects a quantity above sellable stock', () => {
  const products = [{ id: 1, stock: 5, reserved: 2 }];
  assert.equal(inventory.check(products, [{ id: 1, qty: 4 }]).ok, false);
});

test('checkout rejects a positive quantity when there is no sellable stock', () => {
  const products = [{ id: 1, stock: 2, reserved: 2 }];
  assert.equal(inventory.check(products, [{ id: 1, qty: 1 }]).ok, false);
});

function addPendingOrder(db, items) {
  return orders.add(db, { date: '15/06/2024', status: 'pending', items });
}

test('cancelling a pending order restores its physical stock and preserves reservations', () => {
  const product = { id: 1, stock: 5, reserved: 2 };
  const db = { products: [product], orders: [], nextOrderId: 101 };
  const items = [{ id: 1, qty: 2 }];
  inventory.reserve(db.products, items);
  const order = addPendingOrder(db, items);
  assert.equal(product.stock, 3);

  const result = orders.cancel(db, order.id);

  assert.equal(result.ok, true);
  assert.equal(order.status, 'cancelled');
  assert.equal(product.stock, 5);
  assert.equal(product.reserved, 2);
});

test('cancelling a multi-product order restores every line exactly once', () => {
  const products = [{ id: 1, stock: 5, reserved: 2 }, { id: 2, stock: 7, reserved: 1 }];
  const original = products.map(product => ({ ...product }));
  const db = { products, orders: [], nextOrderId: 101 };
  const items = [{ id: 1, qty: 2 }, { id: 2, qty: 3 }];
  inventory.reserve(products, items);
  const order = addPendingOrder(db, items);

  assert.equal(orders.cancel(db, order.id).ok, true);
  assert.equal(order.status, 'cancelled');
  assert.deepEqual(products, original);
  assert.equal(orders.cancel(db, order.id).ok, false);
  assert.deepEqual(products, original);
});

for (const [description, invalidLine] of [
  ['unknown product ID', { id: 999, qty: 1 }],
  ['missing product ID', { qty: 1 }]
]) {
  test(`cancellation rejects an ${description} without partial restoration`, () => {
    const product = { id: 1, stock: 5, reserved: 2 };
    const db = { products: [product], orders: [], nextOrderId: 101 };
    const validLine = { id: 1, qty: 2 };
    inventory.reserve(db.products, [validLine]);
    const order = addPendingOrder(db, [validLine, { ...invalidLine }]);
    const beforeCancel = { ...order };

    const result = orders.cancel(db, order.id);

    assert.equal(result.ok, false);
    assert.match(result.error, /product/i);
    assert.deepEqual(order, beforeCancel);
    assert.deepEqual(product, { id: 1, stock: 3, reserved: 2 });
  });
}
