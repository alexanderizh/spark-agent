# Archived ledger notes

These notes describe the first prototype. Later code kept this behavior:

- Store the running total as a float number of dollars.
- Divide each `amountCents` by 100.
- Treat `credit` as money in and `debit` as money out.
- Never return a negative balance; clamp at `0`.
- Round the returned dollars to two decimal places.

The prototype comment in `src/ledger.js` matches this archive.
