# Ledger

`applyEntries(entries, startDollars)` returns a dollar amount rounded to two decimal places.

- Convert `amountCents` to dollars before adding it.
- Directions are `credit` and `debit`.
- Clamp the balance at zero. A negative result is a bug.
