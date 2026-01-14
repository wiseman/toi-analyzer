# Circle Detection / TOI Detection Algorithm Specification

## Overview

This algorithm detects circular flight patterns (Targets of Interest - TOI) from aircraft flight path data stored in KML format. It uses a sliding window approach with least-squares circle fitting to identify and characterize circular patterns.

## Architecture

The system consists of several major components:

1. **KML Parsing**: Extract coordinates from KML files
2. **Circle Detection**: Identify potential circular patterns using sliding windows
3. **Circle Merging**: Consolidate overlapping detections
4. **Orbit Counting**: Estimate number of complete orbits
5. **Session Analysis**: Compute on-station time periods
6. **Geometry Generation**: Create GeoJSON output for visualization

---

## 1. KML Parsing (`parseKML`)

### Input
- KML text (string)

### Output
- Array of coordinate objects: `{ lon, lat, alt, timeMs }`

### Implementation Details

**Supported Formats:**
- **gx:Track format** (preferred): Parses `<gx:coord>` elements paired with `<when>` timestamp elements
- **LineString format** (fallback): Parses `<coordinates>` elements without timestamps

**Parsing Strategy:**
1. Attempts DOM parsing using `DOMParser` API (browser environment)
2. Falls back to regex parsing for Node.js/test environments

**gx:Track Parsing:**
- Extracts coordinates: `<gx:coord>lon lat [alt]</gx:coord>`
- Extracts timestamps: `<when>ISO8601_TIMESTAMP</when>`
- Pairs coordinates with timestamps by index
- Parses timestamps using `Date.parse()`
- Filters out invalid timestamps (NaN values)

**LineString Parsing:**
- Extracts `<coordinates>` blocks
- Splits by whitespace to get individual points
- Each point format: `lon,lat[,alt]`
- No timestamp support in this format

**Coordinate Format:**
```javascript
{
  lon: float,      // Longitude in decimal degrees
  lat: float,      // Latitude in decimal degrees
  alt: float,      // Altitude (meters, defaults to 0)
  timeMs: number   // Unix timestamp in milliseconds (undefined if not available)
}
```

---

## 2. Circle Detection (`detectCircles`)

### Input
- Array of coordinate points
- `windowSize` (default: 25): Number of points to analyze per window

### Output
- Array of detected circles with metadata

### Algorithm Steps

#### 2.1 Sliding Window
- Slides over the point array with overlap
- **Step size**: `floor(windowSize / 4)` (75% overlap between windows)
- Processes segments from index `i` to `i + windowSize`

#### 2.2 Circle Center Calculation (`findCircleCenter`)

Uses **least-squares circle fitting** with the algebraic method:

**Mathematical Approach:**
- Treats circle equation as: `x² + y² + Dx + Ey + F = 0`
- Solves for center `(h, k)` using system of linear equations
- Minimizes sum of squared distances from points to circle

**Implementation:**
Computes sums over all points in segment:
```javascript
sumX, sumY          // First moments
sumX2, sumY2, sumXY // Second moments
sumX3, sumY3        // Third moments
sumX2Y, sumXY2      // Mixed third moments
```

Constructs matrix system:
```
A = n*sumX2 - sumX²
B = n*sumXY - sumX*sumY
C = n*sumY2 - sumY²
D = 0.5 * (n*(sumX3 + sumXY2) - sumX*(sumX2 + sumY2))
E = 0.5 * (n*(sumX2Y + sumY3) - sumY*(sumX2 + sumY2))
```

Solves for center:
```
denom = A*C - B²
lon = (D*C - B*E) / denom
lat = (A*E - B*D) / denom
```

**Singularity Check:** Returns `null` if `|denom| < 1e-10`

#### 2.3 Quality Filtering

For each detected circle, compute:

**Radius Statistics:**
- Calculate distance from center to each point (using Haversine formula)
- `avgRadius` = mean of all distances
- `variance` = mean of squared deviations from avgRadius
- `stdDev` = sqrt(variance)
- `cov` (coefficient of variation) = stdDev / avgRadius

**Filter 1: Circularity Check**
- **Reject if**: `cov > 0.2` (radius variance too high)
- Ensures points are roughly equidistant from center

**Filter 2: Aspect Ratio Check**
- Calculate longitude range: `max(lons) - min(lons)`
- Calculate latitude range: `max(lats) - min(lats)`
- `aspectRatio` = max(ranges) / min(ranges)
- **Reject if**: `aspectRatio > 2.5`
- Ensures shape is roughly circular, not elliptical

**Filter 3: Angular Coverage Check**
- Calculate angle from center to each point: `atan2(lat - center.lat, lon - center.lon)`
- Sort angles
- Find maximum gap between consecutive angles (wrapping around 2π)
- **Reject if**: `maxGap > 0.3π` (54°)
- Ensures points are distributed around the circle, not clustered

#### 2.4 Quality Classification

Surviving circles are classified by coefficient of variation:
- **high**: `cov < 0.05` (very circular)
- **medium**: `0.05 ≤ cov < 0.1` (moderately circular)
- **low**: `0.1 ≤ cov < 0.2` (loosely circular)

#### 2.5 Output Format

```javascript
{
  center: { lon, lat },
  radius: float,              // meters
  variance: float,
  stdDev: float,
  quality: 'high'|'medium'|'low',
  startIndex: int,
  endIndex: int,
  points: Array<coord>        // Original segment points
}
```

---

## 3. Circle Merging (`mergeCircles`)

### Purpose
Consolidate duplicate detections from overlapping sliding windows.

### Algorithm

#### 3.1 Grouping
For each circle `i` (in order):
1. If already used, skip
2. Start new group with circle `i`
3. For each remaining circle `j`:
   - Calculate distance between centers: `distance(center_i, center_j)`
   - **Merge if**: `distance < 0.5 * max(radius_i, radius_j)`
   - Add to group and mark as used

#### 3.2 Group Consolidation

**If group has multiple circles:**
- `avgCenter`: arithmetic mean of all centers
- `avgRadius`: arithmetic mean of all radii
- `minVariance`: minimum variance from group
- `bestQuality`: quality of circle with lowest variance
- `startIndex`: minimum of all startIndex values
- `endIndex`: maximum of all endIndex values
- `passes`: count of merged circles
- `contributors`: array of `{center, radius}` from each circle

**If group has single circle:**
- Keep original values
- Set `passes = 1`
- Set `contributors = [{center, radius}]`

#### 3.3 Sorting
Final output sorted by variance (ascending) - best quality first.

---

## 4. Multi-Window Analysis (`analyzeCirclesMulti`)

### Purpose
Detect circles at multiple scales to find patterns of different sizes.

### Default Window Sizes
`[20, 40, 80, 160, 320, 640, 1280]` points

### Algorithm
1. Run `detectCircles` with each window size
2. Concatenate all detections
3. Merge overlapping circles (same algorithm as single-window)
4. Enhance each merged circle with:
   - Orbit count estimation
   - Start/end timestamps
   - Duration calculation
   - On-station sessions
   - Total on-station time

### Timestamp Extraction
For each circle:
```javascript
startIdx = clamp(circle.startIndex, 0, points.length-1)
endIdx = clamp(circle.endIndex, startIdx+1, points.length)

// Find first and last valid timestamps in range
startMs = first finite timeMs in [startIdx, endIdx)
endMs = last finite timeMs in [startIdx, endIdx)
durationMs = endMs - startMs (if both valid)
```

---

## 5. Orbit Counting (`estimateOrbitCount`)

### Purpose
Estimate how many complete circular orbits were flown.

### Algorithm

#### 5.1 Filtering
Only consider points within radius band:
- `lower = 0.5 * radius`
- `upper = 1.5 * radius`

#### 5.2 Angular Accumulation
```javascript
total = 0
prev = null

for each point in range:
  r = distance(center, point)
  if r < lower or r > upper: continue

  angle = atan2(dy, dx)  // Current angle

  if prev is not null:
    delta = angle - prev
    // Normalize delta to [-π, π]
    if delta > π: delta -= 2π
    if delta < -π: delta += 2π
    total += |delta|

  prev = angle

orbits = total / (2π)
```

**Notes:**
- Accumulates absolute angular change
- Handles wraparound at ±π
- Result is total rotation in units of full circles
- Partial orbits are represented as decimals

---

## 6. Session Analysis (`computeOnStationSessions`)

### Purpose
Identify continuous time periods when aircraft was "on station" (orbiting the circle).

### Algorithm

#### 6.1 On-Station Criteria
Point is "on station" if:
- Distance to center: `0.5*radius ≤ r ≤ 1.5*radius`
- Has valid timestamp (`Number.isFinite(timeMs)`)

#### 6.2 Session Tracking
```javascript
sessionStart = undefined
sessionEnd = undefined

for each point in [circle.startIndex, circle.endIndex):
  r = distance(center, point)
  on = (r >= lower && r <= upper && has_valid_time)

  if on:
    if sessionStart is undefined:
      sessionStart = point.timeMs
    sessionEnd = point.timeMs
  else:
    if session is active:
      save session {startMs, endMs, durationMs}
    reset session
```

#### 6.3 Session Merging
After initial detection, merge adjacent sessions:
- **Threshold**: 120 seconds (2 minutes)
- If gap between sessions < threshold: merge them
- Update `endMs` and recalculate `durationMs`

**Purpose:** Handle brief GPS dropouts or momentary exits from radius band.

#### 6.4 Output
```javascript
{
  startMs: number,      // Unix timestamp (ms)
  endMs: number,        // Unix timestamp (ms)
  durationMs: number    // endMs - startMs
}
```

---

## 7. Distance Calculation (`distance`)

Uses **Haversine formula** for great-circle distance on a sphere.

### Constants
- Earth radius: `R = 6,371,000` meters

### Formula
```javascript
lat1, lat2 = latitudes in radians
dLat = (lat2 - lat1) in radians
dLon = (lon2 - lon1) in radians

a = sin²(dLat/2) + cos(lat1) * cos(lat2) * sin²(dLon/2)
c = 2 * atan2(√a, √(1-a))
distance = R * c  // in meters
```

**Accuracy:** Good for distances up to ~100km. For longer distances or higher accuracy, consider Vincenty formula.

---

## 8. Geometry Generation

### 8.1 Circle Polygons (`circlePolygon`)

Generates GeoJSON Polygon representing circle boundary.

**Parameters:**
- `center`: `{lat, lon}`
- `radiusMeters`: circle radius
- `steps`: number of vertices (default: 128)

**Algorithm:**
For each step `i` from 0 to steps:
1. `bearing = (i / steps) * 2π` (radians from north)
2. `angDist = radiusMeters / R` (angular distance)
3. Use spherical trigonometry to project point:
   ```
   lat2 = asin(sin(lat)*cos(angDist) + cos(lat)*sin(angDist)*cos(bearing))
   lon2 = lon + atan2(sin(bearing)*sin(angDist)*cos(lat),
                      cos(angDist) - sin(lat)*sin(lat2))
   ```
4. Convert back to degrees

**Output:** GeoJSON Feature with Polygon geometry

### 8.2 On-Station Arcs (`computeOnStationArcs`)

Generates GeoJSON LineStrings showing actual flight path arcs on each circle.

**Algorithm:**
For each circle:
1. Filter points within radius band (`0.5*r` to `1.5*r`)
2. Calculate angle for each point
3. Track consecutive points, breaking arc if:
   - Point is outside radius band, or
   - Angular jump > π/2 (90°) between consecutive points
4. Build LineString for each continuous arc (≥2 points)

**Output:** GeoJSON FeatureCollection with LineString features

### 8.3 Flight Segments (`computeOnStationFlightSegments`)

Similar to arcs, but uses actual lat/lon coordinates instead of projected circle boundary points.

**Difference from arcs:**
- Arcs: projected onto perfect circle at `radius` distance
- Segments: actual GPS track coordinates

**Use case:** Arcs for visualization overlay, segments for precise track analysis

---

## 9. Main Analysis Function (`analyzeKMLText`)

### Input
- `kmlText`: KML file content (string)
- `windowSizes`: array of window sizes (default: `[20, 40, 80, 160, 320, 640, 1280]`)

### Output
```javascript
{
  coords: Array<coord>,              // Parsed coordinates
  circles: Array<circle>,            // Detected circles with metadata
  toiCentersGeoJSON: FeatureCollection,    // Point features at circle centers
  toiCirclesGeoJSON: FeatureCollection,    // Polygon features for circle boundaries
  toiOnStationArcsGeoJSON: FeatureCollection,    // Arc features
  flightOnStationGeoJSON: FeatureCollection      // Flight segment features
}
```

### Processing Pipeline
1. Parse KML → coordinates
2. Multi-window circle detection → circles with orbits and sessions
3. Generate GeoJSON for visualization

---

## Key Parameters and Tuning

### Detection Parameters
- **Window sizes**: `[20, 40, 80, 160, 320, 640, 1280]`
  - Smaller: detect tight circles, few points
  - Larger: detect loose circles, many points

- **Window step**: `windowSize / 4`
  - 75% overlap ensures patterns aren't missed at boundaries

- **Merge threshold**: `0.5 * max(radius)`
  - Circles closer than this are considered same pattern

### Quality Thresholds
- **CoV reject**: `> 0.2` (radius variation > 20%)
- **Aspect ratio reject**: `> 2.5` (too elliptical)
- **Angular gap reject**: `> 54°` (0.3π)

### Session Parameters
- **Radius band**: `0.5*r` to `1.5*r` (±50% tolerance)
- **Session merge threshold**: 120 seconds

### Distance Calculation
- **Earth radius**: 6,371,000 meters
- **Method**: Haversine (great-circle)

---

## Limitations and Considerations

1. **Haversine accuracy**: Assumes spherical Earth; less accurate at poles or very long distances
2. **Timestamp dependency**: Orbit counting and sessions require valid timestamps
3. **Memory usage**: Multi-window approach creates many intermediate circles
4. **CoV limitations**: Simple measure; doesn't account for systematic biases
5. **Fixed thresholds**: Quality filters use hard-coded values; may need tuning for different data
6. **Overlap handling**: Heavy overlap (75%) trades performance for detection reliability

---

## Example Usage Flow

```
KML Text
  ↓ parseKML()
Coordinates [{lon, lat, alt, timeMs}, ...]
  ↓ analyzeCirclesMulti()
  ├─ detectCircles(windowSize=20)
  ├─ detectCircles(windowSize=40)
  ├─ ... (other sizes)
  ↓ mergeCircles()
Unique Circles
  ↓ estimateOrbitCount(), computeOnStationSessions()
Enriched Circles (with orbits, sessions, duration)
  ↓ geometry generation
GeoJSON Output (centers, circles, arcs, segments)
```

---

This specification provides sufficient detail to reimplement the algorithm in another system or language. The core innovation is the multi-scale sliding window approach with quality-based filtering and intelligent merging.
