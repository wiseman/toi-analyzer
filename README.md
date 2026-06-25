# toi-analyzer

A web app that loads aircraft flight tracks from KML and finds circular (loitering/orbit) patterns, visualizing them on a map.

## Run

```sh
pnpm install
pnpm dev
```

## How it detects circles

It slides windows of varying sizes over the track and fits a circle to each window using least-squares, then keeps only fits that are genuinely circular — roughly constant radius, low elongation, and points spread around the full circle rather than clustered in an arc. Overlapping detections from different windows are merged into single orbits, and timestamps are used to estimate orbit counts and on-station time. See [SPEC.md](SPEC.md) for full detail.
