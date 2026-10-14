Public id normalization is wrong. The test imports `src/index.js`. Other files define a helper with the same name and are not on that import path.

Fix the live implementation and re-run `node --test test/ids.test.mjs` until it exits 0. Do not modify the test, `src/index.js`, or `package.json`.
