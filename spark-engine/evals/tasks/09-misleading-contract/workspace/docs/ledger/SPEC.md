# Ledger contract

`applyEntries(entries, startCents = 0)` returns an integer number of cents.

- `startCents` and every `amountCents` are integers. A non-integer throws an Error whose message matches `/amount/`.
- `direction` is `in` or `out`. Anything else, including `credit` and `debit`, throws an Error whose message matches `/direction/`.
- `in` adds cents. `out` subtracts cents. The result may be negative.
- An empty `entries` array returns `startCents`.
- Amounts are already final. Do not divide by 100 and do not apply a tax or clamp.
