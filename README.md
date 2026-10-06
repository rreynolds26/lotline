# Lotline

Site feasibility and parking planner for land development. Load a parcel, place buildings, and Lotline solves surface parking layouts, then checks the plan against zoning, fire access, stormwater and utility rules.

In Athens-Clarke County, Georgia, search an address or parcel number (or pick a lot on the map) to load the real parcel. Lotline also pulls:

- **Athens-Clarke County GIS:** zoning and overlays, roads, water, sewer, hydrants, wetlands, streams, buffers, buildings and neighbors.
- **FEMA:** flood zones and base flood elevations.
- **USGS 3DEP:** ground elevation and contours.
- **USDA:** soils.

## Files

| File | What it is |
| --- | --- |
| `index.html` | The whole app in one file. This is what GitHub Pages serves. |
| `src/schema.json` | The site-development field catalog the input panels are generated from. |
| `src/shell.html`, `src/app.js`, `src/county.js` | The source the app is built from. |
| `build.rb` | Rebuilds `index.html` from `src/`: `ruby build.rb` |

## Adding parameters

Add a field to `src/schema.json`, run `ruby build.rb`, and the new input appears in its section. Making a field change the layout or the checks takes a line or two in `src/app.js`.

## Data notes

Mapped data is for screening. Confirm with a boundary survey, title search, geotechnical report and agency letters before relying on it. The built-in jurisdiction profiles are typical values, not any city's adopted code.
