# maskSecret

`maskSecret(value)` returns a string.

- Throw a `TypeError` when `value` is not a string.
- Count Unicode code points, not UTF-16 code units.
- Length 0 stays empty. Length 1, 2, or 3 becomes that many `*` characters.
- Length 4 or more keeps the first and last code point and replaces every code point between them with `*`.
- Applying the function twice is the same as applying it once.
