# Travel photo workflow

The travel page is generated from Apple Photos without changing the Photos library.

## Commands

```sh
scripts/travel-photos authorize
scripts/travel-photos audit
scripts/travel-photos privacy
scripts/travel-photos sync
scripts/travel-photos publish
scripts/travel-photos favorites
scripts/travel-photos rematch
```

- `authorize` launches the stable app bundle so macOS can show the Photos permission prompt.
- `audit` reads dates and locations, detects places, and prints a private summary.
- `privacy` finds recurring areas that may be a home, office, or other sensitive routine. Exact centres stay in the ignored `.travel-cache/privacy-suggestions.json` file.
- `sync` additionally scores representative candidates locally with Apple Vision and exports one representative JPEG per place to `assets/images/traveling/`.
- `publish` rebuilds the two map layers and generates the metadata-free WebP gallery. The background layer retains every public GPS point; the foreground layer contains only the photographs selected in the folders below.
- `favorites` exports every image currently marked Favorite **and carrying valid GPS** in Apple Photos to the ignored `assets/images/traveling/favorites/` review folder. Favorites without GPS are skipped. The exported JPEGs are resized to fit within 1920 × 1920 pixels and do not retain the source EXIF/GPS metadata.
- `rematch` treats `favorites/` and the top-level `geonames-*.jpg` files only as the approved selection list. Favorite filenames are resolved by their embedded Photos UUID. GeoNames files are matched within that place's candidates using Apple Vision feature prints, a strict distance threshold, and a runner-up margin. It exports the unmodified bytes returned by Photos for `.current` into the ignored `assets/images/traveling/current-rematched/` review folder and writes a private audit to `.travel-cache/current-rematch-report.json`. Ambiguous files are reported instead of guessed.

Run `authorize` once and choose full Photos access. If access was previously denied, enable **Miro Travel Photo Indexer** in System Settings → Privacy & Security → Photos. If an iCloud thumbnail is unavailable locally, rerun the sync with `TRAVEL_DOWNLOAD_MISSING=1` to let Photos download only missing candidate previews:

```sh
TRAVEL_DOWNLOAD_MISSING=1 scripts/travel-photos sync
```

## Privacy gate

Exact Apple Photos identifiers, private-zone centres, and the raw coordinates stay in `.travel-cache/`, which is ignored by Git. Representative images are also ignored.

Before public points can be generated:

1. Review the suggestions from `scripts/travel-photos privacy`.
2. Store every approved home, office, or other private area in the ignored `.travel-cache/travel-private.json` file.
3. Set `requiredPrivateZoneCount` and `privacyReviewed` in `travel-config.json`.
4. Add unwanted GeoNames place IDs to `excludedPlaceIds`.

The `privacy` suggestions are deliberately not applied automatically: a frequently photographed landmark can look like a private routine, so a person should confirm each suggested zone. A sync also stops automatically if a later scan discovers an unreviewed recurring area.

Example ignored private file:

```json
{
  "privateZones": [
    {
      "name": "Home",
      "latitude": 55.6761,
      "longitude": 12.5683,
      "radiusKm": 1.0
    }
  ],
  "allowedRecurringAreas": []
}
```

Public coordinates are rounded according to `coordinatePrecision`; the default of three decimal places is roughly 100 metres.

Place names use the GeoNames `cities15000` dataset. The local world outline uses Natural Earth 1:50m land and land-boundary data so detailed coastlines remain visible; the page does not download interactive map tiles.

## Selecting gallery photographs

The gallery is assembled without city folders:

- Keep or remove Apple Favorites exports in `assets/images/traveling/favorites/`.
- Keep or remove the existing `geonames-*.jpg` representatives directly in `assets/images/traveling/`.
- Run `scripts/travel-photos publish` after screening.

The publisher matches the files back to the private Apple Photos scan, removes duplicates, and writes the public files to the ignored `assets/images/traveling/published/` directory. Keeping a file in either screening folder is treated as explicit approval to publish that selected photograph even when its map point falls inside a private zone. Private zones still suppress the full-library background points. Public filenames are stable one-way hashes; Apple Photos UUIDs never enter the website data. Each WebP preserves the source aspect ratio, is limited to 1800 pixels on its longest side, and is encoded without EXIF, XMP, ICC, or GPS metadata.

Place-specific representatives listed in `excludedRepresentativePlaceIds` in `travel-config.json` will not be restored by a future automatic sync.

Photo captions live in `travel-photo-overrides.json`. Add the stable `photo-…` ID and a description, then rerun `scripts/travel-photos publish`.

## Image hosting

For local preview, keep `imageBaseUrl` in `travel-config.json` set to `assets/images/traveling/published/`. For deployment, the preferred arrangement is:

1. Keep the HTML, JavaScript, map outline, and travel data on GitHub Pages.
2. Put only the generated WebP files in a public Cloudflare R2 bucket behind a custom domain.
3. Set `imageBaseUrl` to that public URL, including the trailing slash.
4. Rerun `scripts/travel-photos publish`, then upload with `scripts/travel-upload`.

The upload script uses the installed AWS CLI with R2's S3-compatible endpoint. It uploads changed WebP files and never deletes remote objects. Configure an R2 API token through the usual `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` environment variables, then run:

```sh
TRAVEL_R2_ENDPOINT=https://ACCOUNT_ID.r2.cloudflarestorage.com \
TRAVEL_R2_BUCKET=miro-travel \
TRAVEL_R2_PREFIX=travel \
scripts/travel-upload
```

## Editing a place card or cover photograph

Card text is kept in `travel-place-overrides.json`. Each place can define:

- `localName`: the name readers see before the English GeoNames name.
- `description`: a short caption such as `Summer Palace, 2026`.
- `imageFilename`: an optional manually supplied cover inside `assets/images/traveling/`.

The representative-image directory remains ignored by Git. A manual image is used only when its filename is safe and the file exists; when present, future Apple Photos syncs do not export over that place. Re-encode a supplied image before use so EXIF, GPS and other source metadata are removed. Keep the longest side around 1920 pixels and use a metadata-free JPEG or WebP.

The easiest cover workflow is:

```sh
# Drop the original into this ignored folder first.
scripts/travel-cover assets/images/traveling/inbox/IMG_1234.HEIC

# If the original has no GPS, identify the existing card explicitly.
scripts/travel-cover assets/images/traveling/inbox/IMG_1234.HEIC \
  --place Beijing \
  --description "Summer Palace, 2026"
```

`travel-cover` reads GPS directly from JPEG/HEIC with macOS ImageIO when available, matches the nearest existing atlas place, writes a 1920-pixel metadata-free JPEG, updates `imageFilename`, and rebuilds the public travel data. It never edits or deletes the dropped original. Visual content alone is not used to guess a city; when GPS is absent, `--place` is required.

Natural Earth country, province and city source files stay in `.travel-cache/geodata/`. Run `node scripts/build-world-outline.mjs` after changing the relevant travel-country set. The generated local map has no runtime tile requests.
