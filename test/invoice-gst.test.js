const test = require('node:test');
const assert = require('node:assert/strict');

// These modules calculate from their inputs and do not import the JSON store.
const coupons = require('../lib/coupons');
const invoice = require('../lib/invoice');
const orders = require('../lib/orders');
const pricing = require('../lib/pricing');
const reports = require('../lib/reports');
const tax = require('../lib/tax');

function mixedItems() {
  return [
    { id: 1, sku: 'TEST-1', name: 'Fixture A', hsn: '1006', price: 125, qty: 2 },
    { id: 2, sku: 'TEST-2', name: 'Fixture B', hsn: '0405', price: 200, qty: 1 },
    { id: 3, sku: 'TEST-3', name: 'Fixture C', hsn: '0902', price: 50, qty: 3 }
  ];
}

function addCheckoutOrder(db, items, coupon = '', status = 'completed') {
  const { subtotal, discount, tax, total } = pricing.computeTotals(items, coupon);
  return orders.add(db, {
    date: '15/06/2024',
    items,
    coupon,
    status,
    subtotal,
    discount,
    tax,
    total
  });
}

function amounts({ subtotal, discount, tax, total }) {
  return { subtotal, discount, tax, total };
}

test('checkout sums unit price times quantity across multiple products', () => {
  const items = mixedItems();

  assert.equal(pricing.subtotal(items), 600);
  assert.equal(pricing.subtotal([
    { price: 1.234, qty: 2 },
    { price: 0.777, qty: 3 }
  ]), 4.8);
});

test('checkout without a coupon applies the 5%, 12%, and 18% GST slabs by line', () => {
  const checkout = pricing.computeTotals(mixedItems(), '');

  assert.deepEqual(amounts(checkout), { subtotal: 600, discount: 0, tax: 63.5, total: 663.5 });
  assert.equal(checkout.taxable, 600);
  assert.deepEqual(checkout.lines.map(line => line.gstPercent), [5, 12, 18]);
  assert.deepEqual(checkout.lines.map(line => line.tax), [12.5, 24, 27]);
  assert.deepEqual([checkout.cgst, checkout.sgst], [31.75, 31.75]);
});

test('checkout and invoice use exact HSN matches and interpret saved GST rates consistently', () => {
  assert.equal(tax.getRateForItem({ hsn: '100630' }), 0.18);
  assert.equal(tax.getRateForItem({}), 0.18);

  const items = [
    { hsn: '1006', price: 100, qty: 1, gstRate: 12 },
    { hsn: '1006', price: 100, qty: 1, gstRate: 0.12 },
    { hsn: '1006', price: 100, qty: 1, gstRate: 0 }
  ];
  const checkout = pricing.computeTotals(items, '');
  const printable = invoice.computeInvoiceFigures({ items });

  assert.deepEqual(checkout.lines.map(line => line.tax), [12, 12, 0]);
  assert.deepEqual(printable.rows.map(line => line.lineTax), [12, 12, 0]);
  assert.deepEqual(printable.rows.map(line => line.gstPercent), [12, 12, 0]);
  assert.equal(printable.tax, 24);
});

test('coupon validation normalizes codes and checks active status and minimum subtotal', () => {
  const valid = coupons.validate(' save10 ', 500);

  assert.equal(valid.valid, true);
  assert.equal(valid.code, 'SAVE10');
  assert.equal(valid.discount, 50);
  assert.deepEqual(coupons.validate('', 0), { valid: true, code: '', discount: 0 });
  assert.match(coupons.validate('SAVE10', 499.99).error, /minimum order subtotal/);
  assert.match(coupons.validate('DIWALI20', 2000).error, /expired/);
  assert.match(coupons.validate('UNKNOWN', 2000).error, /Invalid coupon code/);
  assert.equal(coupons.calculateDiscount(300, 'FLAT50'), 50);
  assert.equal(coupons.calculateDiscount(299.99, 'FLAT50'), 0);
  assert.equal(coupons.calculateDiscount(2000, 'SAVE10'), 150);
});

test('checkout apportions percentage coupon before line GST on a mixed-rate order', () => {
  const checkout = pricing.computeTotals(mixedItems(), 'SAVE10');

  assert.deepEqual(amounts(checkout), { subtotal: 600, discount: 60, tax: 57.15, total: 597.15 });
  assert.equal(checkout.taxable, 540);
  assert.deepEqual(checkout.lines.map(line => line.discount), [25, 20, 15]);
  assert.deepEqual(checkout.lines.map(line => line.taxable), [225, 180, 135]);
  assert.deepEqual(checkout.lines.map(line => line.tax), [11.25, 21.6, 24.3]);
  assert.deepEqual([checkout.cgst, checkout.sgst], [28.58, 28.57]);
});

test('CURRENT BEHAVIOUR: independently rounded line discounts can exceed the cart discount', () => {
  const items = mixedItems().map(item => ({ ...item, price: 6.7, qty: 1 }));
  const checkout = pricing.computeTotals(items, 'WELCOME');

  assert.equal(checkout.discount, 1.01);
  assert.deepEqual(checkout.lines.map(line => line.discount), [0.34, 0.34, 0.34]);
  assert.deepEqual(checkout.lines.map(line => line.taxable), [6.36, 6.36, 6.36]);
  assert.equal(checkout.taxable, 19.09);
});

test('CURRENT BEHAVIOUR: saved order has aggregate billing amounts without the GST breakdown', () => {
  const db = { nextOrderId: 101, orders: [] };
  const items = mixedItems();
  const order = addCheckoutOrder(db, items, 'SAVE10');

  assert.equal(db.nextOrderId, 102);
  assert.deepEqual(db.orders, [order]);
  assert.deepEqual(order.items, items);
  assert.deepEqual(amounts(order), { subtotal: 600, discount: 60, tax: 57.15, total: 597.15 });
  for (const field of ['taxable', 'cgst', 'sgst', 'lines']) {
    assert.equal(Object.hasOwn(order, field), false, field);
  }
});

test('invoice and checkout agree for a no-coupon order taxed at the default 18%', () => {
  const db = { nextOrderId: 101, orders: [] };
  const order = addCheckoutOrder(db, [{ price: 0.5, qty: 1 }]);
  const printable = invoice.computeInvoiceFigures(order);

  assert.deepEqual(amounts(printable), { subtotal: 0.5, discount: 0, tax: 0.09, total: 0.59 });
  assert.deepEqual(amounts(printable), amounts(order));
  assert.deepEqual([printable.cgst, printable.sgst], [0.05, 0.04]);
  assert.doesNotMatch(invoice.render(order), /Accountant Reconciliation Notice/);
});

test('no-coupon mixed-rate invoice applies the checkout HSN slabs', () => {
  const db = { nextOrderId: 101, orders: [] };
  const order = addCheckoutOrder(db, mixedItems());
  const printable = invoice.computeInvoiceFigures(order);

  assert.equal(order.total, 663.5);
  assert.deepEqual(amounts(printable), { subtotal: 600, discount: 0, tax: 63.5, total: 663.5 });
  assert.deepEqual(printable.rows.map(line => line.gstPercent), [5, 12, 18]);
  assert.deepEqual(printable.rows.map(line => line.lineTax), [12.5, 24, 27]);
  assert.deepEqual([printable.cgst, printable.sgst], [31.75, 31.75]);

  const html = invoice.render(order);
  assert.match(html, /CGST \+ SGST \(Total GST\)<\/td><td class="r">₹63\.50/);
  assert.match(html, /Invoice Total<\/td><td class="r">₹663\.50/);
  assert.doesNotMatch(html, /Accountant Reconciliation Notice/);
});

test('discounted mixed-rate invoice uses the checkout discount and post-discount GST', () => {
  const db = { nextOrderId: 101, orders: [] };
  const order = addCheckoutOrder(db, mixedItems(), 'SAVE10');
  const printable = invoice.computeInvoiceFigures(order);

  assert.deepEqual(amounts(order), { subtotal: 600, discount: 60, tax: 57.15, total: 597.15 });
  assert.deepEqual(amounts(printable), { subtotal: 600, discount: 60, tax: 57.15, total: 597.15 });
  assert.match(invoice.render(order), /Coupon Discount \(SAVE10\).*?-₹60\.00/);
});

test('invoice applies the checkout SAVE10 cap and coupon eligibility rules', () => {
  const db = { nextOrderId: 101, orders: [] };
  const order = addCheckoutOrder(db, [{ hsn: '0902', price: 2000, qty: 1 }], 'SAVE10');

  assert.deepEqual(amounts(order), { subtotal: 2000, discount: 150, tax: 333, total: 2183 });
  assert.deepEqual(amounts(invoice.computeInvoiceFigures(order)), {
    subtotal: 2000, discount: 150, tax: 333, total: 2183
  });

  const smallOrder = { items: [{ price: 100, qty: 1 }] };
  assert.equal(coupons.validate('FLAT50', 100).valid, false);
  assert.equal(invoice.computeInvoiceFigures({ ...smallOrder, coupon: 'FLAT50' }).discount, 0);
  assert.equal(coupons.validate('DIWALI20', 2000).valid, false);
  assert.equal(invoice.computeInvoiceFigures({ ...order, coupon: 'DIWALI20' }).discount, 0);
});

test('invoice header GST sums the same rounded row taxes as checkout', () => {
  const items = mixedItems().map(item => ({ ...item, hsn: '0902', price: 0.03, qty: 1 }));
  const printable = invoice.computeInvoiceFigures({ items });

  assert.deepEqual(printable.rows.map(line => line.lineTax), [0.01, 0.01, 0.01]);
  assert.deepEqual(amounts(printable), { subtotal: 0.09, discount: 0, tax: 0.03, total: 0.12 });
});

test('GST reconciliation excludes cancellations and sums absolute payable differences', () => {
  const db = { nextOrderId: 101, orders: [] };
  addCheckoutOrder(db, [{ price: 100, qty: 1 }]);
  // Historical records can disagree with a fresh calculation in either direction.
  addCheckoutOrder(db, mixedItems(), '', 'pending').total = 619;
  addCheckoutOrder(db, [{ price: 2000, qty: 1 }], 'SAVE10').total = 2242;
  addCheckoutOrder(db, mixedItems(), '', 'cancelled');

  const result = reports.getGstReconciliation(db);

  assert.equal(result.totalChecked, 3);
  assert.equal(result.mismatchCount, 2);
  assert.equal(result.totalDelta, 103.5);
  assert.deepEqual(result.rows.map(({ orderId, delta, matched }) => ({ orderId, delta, matched })), [
    { orderId: 101, delta: 0, matched: true },
    { orderId: 102, delta: 44.5, matched: false },
    { orderId: 103, delta: -59, matched: false }
  ]);
});

test('CURRENT BEHAVIOUR: GST-only difference flags reconciliation but does not show an invoice warning', () => {
  const db = { nextOrderId: 101, orders: [] };
  // An in-memory historical record with an equal grand total and different saved tax.
  const order = orders.add(db, {
    date: '15/06/2024',
    items: [{ price: 100, qty: 1 }],
    subtotal: 100,
    discount: 0,
    tax: 17.99,
    total: 118
  });
  const result = reports.getGstReconciliation(db);

  assert.equal(result.mismatchCount, 1);
  assert.equal(result.totalDelta, 0);
  assert.equal(result.rows[0].delta, 0);
  assert.equal(result.rows[0].ledgerTax, 17.99);
  assert.equal(result.rows[0].invoiceTax, 18);
  assert.equal(result.rows[0].matched, false);
  assert.doesNotMatch(invoice.render(order), /Accountant Reconciliation Notice/);
});
