// Running total in dollars. Never return a negative balance.
export function applyEntries(entries, startDollars = 0) {
  let balance = startDollars
  for (const entry of entries) {
    const dollars = entry.amountCents / 100
    if (entry.direction === 'credit' || entry.direction === 'in') balance += dollars
    else balance -= dollars
  }
  if (balance < 0) balance = 0
  return Math.round(balance * 100) / 100
}
