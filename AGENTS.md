# ShopLedger agent instructions

## Project Overview

ShopLedger is an internal wholesale and retail point-of-sale application for grocery billing, stock tracking, Khata customer credit and settlements, printable GST invoices, and reconciliation reports. The backend uses Node.js with CommonJS JavaScript. The direct dependencies declared in `package.json` are Express (`^4.17.1`) and `body-parser` (`^1.19.0`). The browser UI uses HTML, CSS, and JavaScript with `XMLHttpRequest`. Application records are stored in a local JSON file.

## Module Map

| Path | Responsibility |
| --- | --- |
| `server.js` | Application entry point. Configures Express JSON parsing and static files, mounts the four routers under `/api`, and serves printable HTML at `GET /orders/:id/invoice`. It exports the app and starts listening only when run directly. |
| `config.js` | Defines `PORT` with a default of `3000`, shop details, GST rates, coupon rules, inventory defaults, and the admin export key. |
| `routes/` | `products.js` handles catalog and coupon listing. `orders.js` handles order listing, lookup, placement, and cancellation. `customers.js` handles customer listing and settlements. `reports.js` handles dashboard and GST reconciliation reports, cart pricing preview, and admin export. |
| `lib/` | `pricing.js`, `coupons.js`, and `tax.js` calculate checkout totals. `orders.js`, `inventory.js`, and `ledger.js` manage order records, stock, and customer credit. `invoice.js` recomputes and renders invoices. `reports.js` aggregates dashboard figures and compares invoice and saved totals. `dates.js` provides date helpers. `store.js` synchronously reads and rewrites the JSON store and maintains its audit entries. |
| `public/` | `index.html`, `css/style.css`, and `js/app.js` implement the browser UI and its API calls. |
| `data/db.json` | Application datastore containing products, orders, customers, settlements, audit entries, and ID counters. |

## Development Commands

These commands were checked against the repository by inspection. None was executed during this checkpoint.

| Command | Repository evidence |
| --- | --- |
| `npm install` | Installs the dependencies declared in `package.json`. Listed for reference. Follow the dependency rule below. |
| `npm start` | The start script runs `node server.js`, which starts the Express listener on the configured port. |
| `node server.js` | Runs the same entry point directly. |
| `npm test` | The declared script prints `Error: no test specified` and exits with status 1. The project contains no test suite or configured test runner. |

## Mandatory Engineering Rules

1. Write characterization tests that capture current behavior before changing application behavior.
2. Modify only the modules directly related to the assigned ticket. Avoid unrelated refactoring.
3. Tests must never read, write, modify, reset, or depend on the real `data/db.json`. Use isolated in-memory test data created for each test. Keep any test path that reaches storage isolated from the real datastore.
4. Do not add or install new dependencies.
5. Keep fixes minimal and preserve unrelated functionality.
6. Do not commit secrets, credentials, or sensitive data.
7. Review all changes before committing.
