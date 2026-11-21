const test = require('node:test');
const assert = require('node:assert/strict');
const { computeInvoiceFigures, render } = require('../lib/invoice');
const { add } = require('../lib/orders');
const { computeTotals } = require('../lib/pricing');

test('invoice matches the billed GST slabs, capped discount, and payable on a mixed order', () => {
  const items = [
    { hsn: '1006', price: 600, qty: 2 },
    { hsn: '0405', price: 500, qty: 1 },
    { hsn: '0902', price: 300, qty: 1 }
  ];
  const coupon = 'SAVE10';
  const checkout = computeTotals(items, coupon);
  const order = add({ nextOrderId: 101, orders: [] }, {
    date: '15/06/2024',
    items,
    coupon,
    ...checkout
  });
  const invoice = computeInvoiceFigures(order);

  assert.equal(invoice.total, 2010.95);
  assert.equal(invoice.total, order.total);
  assert.equal(invoice.subtotal, order.subtotal);
  assert.equal(invoice.discount, 150);
  assert.equal(invoice.discount, order.discount);
  assert.equal(invoice.tax, 160.95);
  assert.equal(invoice.tax, order.tax);
  assert.deepEqual([invoice.cgst, invoice.sgst], [80.48, 80.47]);
  assert.deepEqual(invoice.rows.map(row => [row.gstPercent, row.lineTax]), [
    [5, 55.5], [12, 55.5], [18, 49.95]
  ]);
  assert.doesNotMatch(render(order), /Accountant Reconciliation Notice/);
});
