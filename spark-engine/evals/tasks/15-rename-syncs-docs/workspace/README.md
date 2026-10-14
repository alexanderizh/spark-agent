# pack

Joins its inputs into one `bundle.txt`.

## Usage

```bash
pack --outdir build alpha beta
```

| Option           | Default | Meaning                     |
| ---------------- | ------- | --------------------------- |
| `--outdir <dir>` | `dist`  | Directory for `bundle.txt`. |
| `--help`         |         | Print usage and exit.       |

`pack` creates the `--outdir` directory when it does not exist.
