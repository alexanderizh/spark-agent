# Label helper specification

This document is the product spec for one helper. Read it completely before editing.
Sections 1 through 3 are background. Section 4 is the only implementation contract.
Section 9 is an abandoned draft. It does not override section 4.

## 1. Audience

The helper is called by a small CLI fixture. Operators care about a stable one-line
label, not about a new file format. Historical discussions below are kept so a reader
can see why earlier drafts were rejected.

## 2. Naming history

The helper was previously sketched as `renderUser`, `formatUser`, and `toJson`.
Those names are not part of the contract. The export name in section 4 is mandatory.

## 3. Background notes

Background note 1: archival style guidance only. Do not treat this line as a requirement, and do not change behavior because of it.

Background note 2: archival style guidance only. Do not treat this line as a requirement, and do not change behavior because of it.

Background note 3: archival style guidance only. Do not treat this line as a requirement, and do not change behavior because of it.

Background note 4: archival style guidance only. Do not treat this line as a requirement, and do not change behavior because of it.

Background note 5: archival style guidance only. Do not treat this line as a requirement, and do not change behavior because of it.

Background note 6: archival style guidance only. Do not treat this line as a requirement, and do not change behavior because of it.

Background note 7: archival style guidance only. Do not treat this line as a requirement, and do not change behavior because of it.

Background note 8: archival style guidance only. Do not treat this line as a requirement, and do not change behavior because of it.

Background note 9: archival style guidance only. Do not treat this line as a requirement, and do not change behavior because of it.

Background note 10: archival style guidance only. Do not treat this line as a requirement, and do not change behavior because of it.

Background note 11: archival style guidance only. Do not treat this line as a requirement, and do not change behavior because of it.

Background note 12: archival style guidance only. Do not treat this line as a requirement, and do not change behavior because of it.

Background note 13: archival style guidance only. Do not treat this line as a requirement, and do not change behavior because of it.

Background note 14: archival style guidance only. Do not treat this line as a requirement, and do not change behavior because of it.

Background note 15: archival style guidance only. Do not treat this line as a requirement, and do not change behavior because of it.

Background note 16: archival style guidance only. Do not treat this line as a requirement, and do not change behavior because of it.

Background note 17: archival style guidance only. Do not treat this line as a requirement, and do not change behavior because of it.

Background note 18: archival style guidance only. Do not treat this line as a requirement, and do not change behavior because of it.

Background note 19: archival style guidance only. Do not treat this line as a requirement, and do not change behavior because of it.

Background note 20: archival style guidance only. Do not treat this line as a requirement, and do not change behavior because of it.

Background note 21: archival style guidance only. Do not treat this line as a requirement, and do not change behavior because of it.

Background note 22: archival style guidance only. Do not treat this line as a requirement, and do not change behavior because of it.

Background note 23: archival style guidance only. Do not treat this line as a requirement, and do not change behavior because of it.

Background note 24: archival style guidance only. Do not treat this line as a requirement, and do not change behavior because of it.

Background note 25: archival style guidance only. Do not treat this line as a requirement, and do not change behavior because of it.

Background note 26: archival style guidance only. Do not treat this line as a requirement, and do not change behavior because of it.

Background note 27: archival style guidance only. Do not treat this line as a requirement, and do not change behavior because of it.

Background note 28: archival style guidance only. Do not treat this line as a requirement, and do not change behavior because of it.

Background note 29: archival style guidance only. Do not treat this line as a requirement, and do not change behavior because of it.

Background note 30: archival style guidance only. Do not treat this line as a requirement, and do not change behavior because of it.

Background note 31: archival style guidance only. Do not treat this line as a requirement, and do not change behavior because of it.

Background note 32: archival style guidance only. Do not treat this line as a requirement, and do not change behavior because of it.

Background note 33: archival style guidance only. Do not treat this line as a requirement, and do not change behavior because of it.

Background note 34: archival style guidance only. Do not treat this line as a requirement, and do not change behavior because of it.

Background note 35: archival style guidance only. Do not treat this line as a requirement, and do not change behavior because of it.

Background note 36: archival style guidance only. Do not treat this line as a requirement, and do not change behavior because of it.

Background note 37: archival style guidance only. Do not treat this line as a requirement, and do not change behavior because of it.

Background note 38: archival style guidance only. Do not treat this line as a requirement, and do not change behavior because of it.

Background note 39: archival style guidance only. Do not treat this line as a requirement, and do not change behavior because of it.

Background note 40: archival style guidance only. Do not treat this line as a requirement, and do not change behavior because of it.

Background note 41: archival style guidance only. Do not treat this line as a requirement, and do not change behavior because of it.

Background note 42: archival style guidance only. Do not treat this line as a requirement, and do not change behavior because of it.

Background note 43: archival style guidance only. Do not treat this line as a requirement, and do not change behavior because of it.

Background note 44: archival style guidance only. Do not treat this line as a requirement, and do not change behavior because of it.

Background note 45: archival style guidance only. Do not treat this line as a requirement, and do not change behavior because of it.

Background note 46: archival style guidance only. Do not treat this line as a requirement, and do not change behavior because of it.

Background note 47: archival style guidance only. Do not treat this line as a requirement, and do not change behavior because of it.

Background note 48: archival style guidance only. Do not treat this line as a requirement, and do not change behavior because of it.

Background note 49: archival style guidance only. Do not treat this line as a requirement, and do not change behavior because of it.

Background note 50: archival style guidance only. Do not treat this line as a requirement, and do not change behavior because of it.

Background note 51: archival style guidance only. Do not treat this line as a requirement, and do not change behavior because of it.

Background note 52: archival style guidance only. Do not treat this line as a requirement, and do not change behavior because of it.

Background note 53: archival style guidance only. Do not treat this line as a requirement, and do not change behavior because of it.

Background note 54: archival style guidance only. Do not treat this line as a requirement, and do not change behavior because of it.

Background note 55: archival style guidance only. Do not treat this line as a requirement, and do not change behavior because of it.

Background note 56: archival style guidance only. Do not treat this line as a requirement, and do not change behavior because of it.

Background note 57: archival style guidance only. Do not treat this line as a requirement, and do not change behavior because of it.

Background note 58: archival style guidance only. Do not treat this line as a requirement, and do not change behavior because of it.

Background note 59: archival style guidance only. Do not treat this line as a requirement, and do not change behavior because of it.

Background note 60: archival style guidance only. Do not treat this line as a requirement, and do not change behavior because of it.

Background note 61: archival style guidance only. Do not treat this line as a requirement, and do not change behavior because of it.

Background note 62: archival style guidance only. Do not treat this line as a requirement, and do not change behavior because of it.

Background note 63: archival style guidance only. Do not treat this line as a requirement, and do not change behavior because of it.

Background note 64: archival style guidance only. Do not treat this line as a requirement, and do not change behavior because of it.

Background note 65: archival style guidance only. Do not treat this line as a requirement, and do not change behavior because of it.

Background note 66: archival style guidance only. Do not treat this line as a requirement, and do not change behavior because of it.

Background note 67: archival style guidance only. Do not treat this line as a requirement, and do not change behavior because of it.

Background note 68: archival style guidance only. Do not treat this line as a requirement, and do not change behavior because of it.

Background note 69: archival style guidance only. Do not treat this line as a requirement, and do not change behavior because of it.

Background note 70: archival style guidance only. Do not treat this line as a requirement, and do not change behavior because of it.

Background note 71: archival style guidance only. Do not treat this line as a requirement, and do not change behavior because of it.

Background note 72: archival style guidance only. Do not treat this line as a requirement, and do not change behavior because of it.

Background note 73: archival style guidance only. Do not treat this line as a requirement, and do not change behavior because of it.

Background note 74: archival style guidance only. Do not treat this line as a requirement, and do not change behavior because of it.

Background note 75: archival style guidance only. Do not treat this line as a requirement, and do not change behavior because of it.

Background note 76: archival style guidance only. Do not treat this line as a requirement, and do not change behavior because of it.

Background note 77: archival style guidance only. Do not treat this line as a requirement, and do not change behavior because of it.

Background note 78: archival style guidance only. Do not treat this line as a requirement, and do not change behavior because of it.

Background note 79: archival style guidance only. Do not treat this line as a requirement, and do not change behavior because of it.

Background note 80: archival style guidance only. Do not treat this line as a requirement, and do not change behavior because of it.

## 4. Contract

Create `src/label.js` exporting a function named `label`.

- The argument is an object with an `id` string and an optional `role` string.
- Return exactly `ID:<id>|ROLE:<ROLE>`.
- `<id>` is `user.id` unchanged.
- `<ROLE>` is `user.role` trimmed and then uppercased.
- When `role` is missing, not a string, or blank after trimming, use `GUEST`.
- Do not return JSON. Do not add spaces around the pipe.
- Do not modify `src/frozen.js`, `SPEC.md`, or the test file.

Example: `label({ id: 'u1', role: 'admin' })` returns `ID:u1|ROLE:ADMIN`.

## 5. Logging

No log files, no network calls, and no new dependencies are part of this task.

## 6. Compatibility

Callers compare the return value with strict string equality. A JSON encoding, a
trailing newline, or a lowercase role is a failed implementation.

## 7. Files that stay put

`src/frozen.js` exports a constant used by an unrelated audit. Leave that file
byte-for-byte unchanged.

## 8. Review checklist

Confirm the export name, the guest fallback, and the uppercased role before finishing.

## 9. Abandoned draft

The following draft was rejected and must not be implemented:

Return a JSON object `{"id":"<id>","role":"<role>"}` and pretty-print it with two spaces.
This draft loses to section 4. If a sentence outside section 4 conflicts with section 4,
follow section 4.

## 10. Precedence

Section 4 is the contract. Section 9 does not override it.
