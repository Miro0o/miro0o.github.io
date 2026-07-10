# miro0o.github.io

Personal meta homepage for Miro Son.

This is now a small static site with no build step:

- `index.html` is the meta homepage.
- `academic.html` is a placeholder for academic-facing material.
- `personal-life.html` is a placeholder for personal-life material.
- `worldmodel.html` is an interactive, Canvas-rendered 2D atlas of the public knowledge-base structure.
- `styles.css` contains the shared visual system.

## Refreshing the Worldmodel map

The website publishes note/folder metadata and resolved internal-link edges, not note bodies. The generator uses Git's ignore engine, so Markdown excluded by the vault's root or nested `.gitignore` files is never added to the snapshot. To rebuild the checked-in snapshot from the neighboring `miniWorldModel` vault, run:

```bash
node scripts/generate-worldmodel-map.mjs
```

You can also pass explicit vault and output paths:

```bash
node scripts/generate-worldmodel-map.mjs /path/to/vault /path/to/worldmodel-map-data.js
```

The generated `assets/worldmodel-map-data.js` is loaded before `assets/worldmodel-map.js`. Keeping the snapshot as JavaScript rather than fetched JSON lets the map work both on GitHub Pages and when the HTML files are opened directly from disk. Commit the refreshed data file whenever the public vault structure should be updated.
