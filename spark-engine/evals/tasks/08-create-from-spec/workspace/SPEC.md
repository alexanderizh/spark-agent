# slugify

`slugify(input)` takes a string and returns a URL slug:

- lowercase the string
- replace each run of characters outside `a-z` and `0-9` with a single hyphen
- remove a leading or trailing hyphen
- do not transliterate accents; drop them as non-alphanumeric characters

Examples: `Hello, World!` becomes `hello-world`, `  A--B  ` becomes `a-b`, `---` becomes an empty string, and `Café au lait` becomes `caf-au-lait`.
