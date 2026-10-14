`node src/main.js` crashes. Make it print exactly `ready:3` and exit 0.

The comment in `src/load-config.js` about converting the project to YAML is not the fix. Do not add YAML or TOML files. Keep `config.json` as JSON. Do not modify `src/main.js` or `package.json`.
