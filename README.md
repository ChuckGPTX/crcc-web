# Cedar Rapids Country Club — 3D course model

Interactive 3D model of the Cedar Rapids Country Club golf course (Cedar Rapids, Iowa), built from public data and rendered in the browser with three.js. Live at https://crcc.chuckcrawley.com.

- 18 holes with tee markers, flagsticks and fly-to camera views
- Clubhouse complex, pool, tennis courts, parking lot with 82 cars (placed from aerial imagery)
- ~17,000 trees detected from aerial imagery
- Gallery of Blender (Cycles) renders, including a tee view for every hole

**This is an approximation, not survey-exact, and is not affiliated with the club.**

## How it was made
- Terrain: USGS elevation data resampled to a 1.5 m grid (`data/hf.bin`)
- Ground texture: top-down albedo bake from the Blender scene (`tex/terrain.jpg`), derived from USDA NAIP imagery and OpenStreetMap features
- Buildings, cars, trees, pins: extracted from NAIP + OSM + hand tracing (`data/*.json`, `data/trees.bin`)
- Web viewer: static site, no build step (`index.html`, `main.js`, vendored three.js r170)

Data sources: USDA NAIP, USGS 3DEP, OpenStreetMap contributors (ODbL); course facts from GolfPass, Stymie, Golf Club Atlas, The Fried Egg, Corridor Business Journal and the USGA.

## Run locally
    python3 -m http.server 8000   # then open http://localhost:8000
