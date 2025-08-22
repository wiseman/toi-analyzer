// Core KML parsing and circle detection/extraction logic
// Exposed as ES module exports for unit testing

// --- Parsing ---
export function parseKML(kmlText) {
    // Prefer DOMParser when available, but provide a regex fallback for Node/test environments
    try {
        if (typeof DOMParser !== 'undefined') {
            const parser = new DOMParser();
            const kml = parser.parseFromString(kmlText, 'text/xml');
            const coords = [];
            const lineStrings = kml.getElementsByTagName('LineString');
            const tracks = kml.getElementsByTagName('gx:Track');

            if (tracks.length > 0) {
                for (let track of tracks) {
                    const coordElements = track.getElementsByTagName('gx:coord');
                    const whenElements = track.getElementsByTagName('when');
                    const times = Array.from(whenElements)
                        .map(w => Date.parse(w.textContent.trim()))
                        .filter(t => !Number.isNaN(t));
                    const numPairs = Math.min(coordElements.length, times.length);
                    if (numPairs > 0) {
                        for (let i = 0; i < numPairs; i++) {
                            const parts = coordElements[i].textContent.trim().split(/\s+/);
                            if (parts.length >= 2) {
                                coords.push({
                                    lon: parseFloat(parts[0]),
                                    lat: parseFloat(parts[1]),
                                    alt: parts.length > 2 ? parseFloat(parts[2]) : 0,
                                    timeMs: times[i]
                                });
                            }
                        }
                    } else {
                        for (let coord of coordElements) {
                            const parts = coord.textContent.trim().split(/\s+/);
                            if (parts.length >= 2) {
                                coords.push({
                                    lon: parseFloat(parts[0]),
                                    lat: parseFloat(parts[1]),
                                    alt: parts.length > 2 ? parseFloat(parts[2]) : 0,
                                    timeMs: undefined
                                });
                            }
                        }
                    }
                }
            } else if (lineStrings.length > 0) {
                for (let ls of lineStrings) {
                    const coordElements = ls.getElementsByTagName('coordinates');
                    if (coordElements.length > 0) {
                        const coordText = coordElements[0].textContent.trim();
                        const points = coordText.split(/\s+/);
                        for (let point of points) {
                            const parts = point.split(',');
                            if (parts.length >= 2) {
                                coords.push({
                                    lon: parseFloat(parts[0]),
                                    lat: parseFloat(parts[1]),
                                    alt: parts.length > 2 ? parseFloat(parts[2]) : 0,
                                    timeMs: undefined
                                });
                            }
                        }
                    }
                }
            }
            return coords;
        }
    } catch (_) {
        // fall through to regex fallback
    }

    // Regex fallback: supports gx:Track and LineString coordinates
    const coords = [];
    const trackCoordMatches = [...kmlText.matchAll(/<gx:coord>\s*([\-0-9\.]+)\s+([\-0-9\.]+)(?:\s+([\-0-9\.]+))?\s*<\/gx:coord>/g)];
    const whenMatches = [...kmlText.matchAll(/<when>\s*([^<]+)\s*<\/when>/g)].map(m => Date.parse(m[1])).filter(t => !Number.isNaN(t));
    if (trackCoordMatches.length > 0) {
        const numPairs = Math.min(trackCoordMatches.length, whenMatches.length || trackCoordMatches.length);
        for (let i = 0; i < numPairs; i++) {
            const m = trackCoordMatches[i];
            coords.push({
                lon: parseFloat(m[1]),
                lat: parseFloat(m[2]),
                alt: m[3] !== undefined ? parseFloat(m[3]) : 0,
                timeMs: whenMatches[i]
            });
        }
    } else {
        const lineStringBlocks = [...kmlText.matchAll(/<coordinates>([\s\S]*?)<\/coordinates>/g)];
        for (const block of lineStringBlocks) {
            const points = block[1].trim().split(/\s+/);
            for (const point of points) {
                const parts = point.split(',');
                if (parts.length >= 2) {
                    coords.push({
                        lon: parseFloat(parts[0]),
                        lat: parseFloat(parts[1]),
                        alt: parts.length > 2 ? parseFloat(parts[2]) : 0,
                        timeMs: undefined
                    });
                }
            }
        }
    }
    return coords;
}

// --- Geometry helpers ---
export function distance(p1, p2) {
    const R = 6371000;
    const lat1 = p1.lat * Math.PI / 180;
    const lat2 = p2.lat * Math.PI / 180;
    const dLat = (p2.lat - p1.lat) * Math.PI / 180;
    const dLon = (p2.lon - p1.lon) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function findCircleCenter(points) {
    let sumX = 0, sumY = 0, sumX2 = 0, sumY2 = 0, sumXY = 0, sumX3 = 0, sumY3 = 0, sumX2Y = 0, sumXY2 = 0;
    const n = points.length;
    for (let p of points) {
        const x = p.lon, y = p.lat;
        sumX += x; sumY += y; sumX2 += x * x; sumY2 += y * y; sumXY += x * y;
        sumX3 += x * x * x; sumY3 += y * y * y; sumX2Y += x * x * y; sumXY2 += x * y * y;
    }
    const A = n * sumX2 - sumX * sumX;
    const B = n * sumXY - sumX * sumY;
    const C = n * sumY2 - sumY * sumY;
    const D = 0.5 * (n * (sumX3 + sumXY2) - sumX * (sumX2 + sumY2));
    const E = 0.5 * (n * (sumX2Y + sumY3) - sumY * (sumX2 + sumY2));
    const denom = A * C - B * B;
    if (Math.abs(denom) < 1e-10) return null;
    return { lon: (D * C - B * E) / denom, lat: (A * E - B * D) / denom };
}

export function detectCircles(points, windowSize = 25) {
    const circles = [];
    for (let i = 0; i <= points.length - windowSize; i += Math.floor(windowSize / 4)) {
        const segment = points.slice(i, i + windowSize);
        const center = findCircleCenter(segment);
        if (!center) continue;

        const distances = segment.map(p => distance(center, p));
        const avgRadius = distances.reduce((a, b) => a + b, 0) / distances.length;
        const variance = distances.reduce((s, d) => s + (d - avgRadius) * (d - avgRadius), 0) / distances.length;
        const stdDev = Math.sqrt(variance);
        const cov = stdDev / avgRadius;
        if (cov > 0.2) continue;

        const lons = segment.map(p => p.lon), lats = segment.map(p => p.lat);
        const lonRange = Math.max(...lons) - Math.min(...lons);
        const latRange = Math.max(...lats) - Math.min(...lats);
        const aspectRatio = Math.max(lonRange, latRange) / Math.min(lonRange, latRange);
        if (aspectRatio > 2.5) continue;

        const angles = segment.map(p => Math.atan2(p.lat - center.lat, p.lon - center.lon)).sort((a, b) => a - b);
        let maxGap = 0;
        for (let j = 1; j < angles.length; j++) maxGap = Math.max(maxGap, angles[j] - angles[j - 1]);
        maxGap = Math.max(maxGap, 2 * Math.PI + angles[0] - angles[angles.length - 1]);
        if (maxGap > Math.PI * 0.3) continue;

        circles.push({
            center, radius: avgRadius, variance, stdDev,
            quality: cov < 0.05 ? 'high' : (cov < 0.1 ? 'medium' : 'low'),
            startIndex: i, endIndex: i + windowSize, points: segment
        });
    }
    return circles;
}

export function mergeCircles(circles) {
    const merged = []; const used = new Set();
    for (let i = 0; i < circles.length; i++) {
        if (used.has(i)) continue;
        const group = [circles[i]]; used.add(i);
        for (let j = i + 1; j < circles.length; j++) {
            if (used.has(j)) continue;
            const dist = distance(circles[i].center, circles[j].center);
            if (dist < Math.max(circles[i].radius, circles[j].radius) * 0.5) { group.push(circles[j]); used.add(j); }
        }
        if (group.length > 1) {
            const avgCenter = {
                lon: group.reduce((s, c) => s + c.center.lon, 0) / group.length,
                lat: group.reduce((s, c) => s + c.center.lat, 0) / group.length
            };
            const avgRadius = group.reduce((s, c) => s + c.radius, 0) / group.length;
            const minVariance = Math.min(...group.map(c => c.variance));
            const bestQuality = group.reduce((best, c) => c.variance < best.variance ? c : best).quality;
            const startIndex = Math.min(...group.map(c => c.startIndex));
            const endIndex = Math.max(...group.map(c => c.endIndex));
            merged.push({ center: avgCenter, radius: avgRadius, variance: minVariance, quality: bestQuality, passes: group.length, points: group[0].points, contributors: group.map(c => ({ center: c.center, radius: c.radius })), startIndex, endIndex });
        } else {
            merged.push({ ...group[0], passes: 1, contributors: [{ center: group[0].center, radius: group[0].radius }], startIndex: group[0].startIndex, endIndex: group[0].endIndex });
        }
    }
    return merged.sort((a, b) => a.variance - b.variance);
}

export function analyzeCircles(points, windowSize = 25) {
    return mergeCircles(detectCircles(points, windowSize));
}

export function estimateOrbitCount(points, center, radius) {
    if (!points || points.length < 2) return 0;
    const lower = radius * 0.5, upper = radius * 1.5;
    let prev = null, total = 0;
    for (let i = 0; i < points.length; i++) {
        const p = points[i]; const dx = p.lon - center.lon, dy = p.lat - center.lat;
        const r = distance(center, p); if (r < lower || r > upper) continue;
        const ang = Math.atan2(dy, dx);
        if (prev === null) { prev = ang; continue; }
        let d = ang - prev; if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI;
        total += Math.abs(d); prev = ang;
    }
    return total / (2 * Math.PI);
}

export function analyzeCirclesMulti(points, windowSizes = [20, 40, 80, 160, 320, 640, 1280]) {
    let all = [];
    for (const ws of windowSizes) all = all.concat(detectCircles(points, ws));
    const merged = mergeCircles(all);
    return merged.map(c => {
        const startIdx = Math.max(0, Math.min(points.length - 1, c.startIndex ?? 0));
        const endIdxExclusive = Math.max(startIdx + 1, Math.min(points.length, c.endIndex ?? 0));
        let startMs = undefined, endMs = undefined;
        for (let i = startIdx; i < endIdxExclusive; i++) {
            const t = points[i]?.timeMs;
            if (Number.isFinite(t)) {
                if (startMs === undefined) startMs = t;
                endMs = t;
            }
        }
        const durationMs = (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs >= startMs) ? (endMs - startMs) : undefined;
        const sessions = computeOnStationSessions(points, c);
        const totalOnStationMs = sessions.reduce((s, sess) => s + (Number.isFinite(sess.durationMs) ? sess.durationMs : 0), 0);
        return { ...c, orbits: estimateOrbitCount(points, c.center, c.radius), startMs, endMs, durationMs, sessions, totalOnStationMs };
    });
}

// --- Circle geometry + sessions/arcs ---
export function circlePolygon(center, radiusMeters, steps = 128) {
    const coords = [];
    const R = 6371000;
    const lat = center.lat * Math.PI / 180;
    const lon = center.lon * Math.PI / 180;
    for (let i = 0; i <= steps; i++) {
        const bearing = (i / steps) * 2 * Math.PI;
        const angDist = radiusMeters / R;
        const lat2 = Math.asin(Math.sin(lat) * Math.cos(angDist) + Math.cos(lat) * Math.sin(angDist) * Math.cos(bearing));
        const lon2 = lon + Math.atan2(Math.sin(bearing) * Math.sin(angDist) * Math.cos(lat), Math.cos(angDist) - Math.sin(lat) * Math.sin(lat2));
        coords.push([lon2 * 180 / Math.PI, lat2 * 180 / Math.PI]);
    }
    return {
        type: 'Feature',
        properties: {},
        geometry: { type: 'Polygon', coordinates: [coords] }
    };
}

export function bearingToCoordinate(center, radiusMeters, bearing) {
    const R = 6371000;
    const lat = center.lat * Math.PI / 180;
    const lon = center.lon * Math.PI / 180;
    const angDist = radiusMeters / R;
    const lat2 = Math.asin(Math.sin(lat) * Math.cos(angDist) + Math.cos(lat) * Math.sin(angDist) * Math.cos(bearing));
    const lon2 = lon + Math.atan2(Math.sin(bearing) * Math.sin(angDist) * Math.cos(lat), Math.cos(angDist) - Math.sin(lat) * Math.sin(lat2));
    return [lon2 * 180 / Math.PI, lat2 * 180 / Math.PI];
}

export function angleDiff(a, b) {
    let d = a - b;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    return d;
}

export function computeOnStationSessions(points, circle) {
    const sessions = [];
    if (!points || points.length === 0 || !circle) return sessions;
    const radius = circle.radius;
    const lower = radius * 0.5;
    const upper = radius * 1.5;
    const startIdx = Math.max(0, Math.min(points.length - 1, circle.startIndex ?? 0));
    const endIdxExclusive = Math.max(startIdx + 1, Math.min(points.length, circle.endIndex ?? points.length));

    let sessionStart = undefined;
    let sessionEnd = undefined;

    for (let i = startIdx; i < endIdxExclusive; i++) {
        const p = points[i];
        const r = distance(circle.center, p);
        const t = p?.timeMs;
        const on = r >= lower && r <= upper;

        if (on && Number.isFinite(t)) {
            if (sessionStart === undefined) sessionStart = t;
            sessionEnd = t;
        } else {
            if (Number.isFinite(sessionStart) && Number.isFinite(sessionEnd) && sessionEnd >= sessionStart) {
                sessions.push({ startMs: sessionStart, endMs: sessionEnd, durationMs: sessionEnd - sessionStart });
            }
            sessionStart = undefined;
            sessionEnd = undefined;
        }
    }

    if (Number.isFinite(sessionStart) && Number.isFinite(sessionEnd) && sessionEnd >= sessionStart) {
        sessions.push({ startMs: sessionStart, endMs: sessionEnd, durationMs: sessionEnd - sessionStart });
    }

    // Merge adjacent sessions if the gap between them is less than 120 seconds
    const merged = [];
    const thresholdMs = 120 * 1000;
    for (let i = 0; i < sessions.length; i++) {
        const curr = sessions[i];
        if (merged.length === 0) {
            merged.push({ ...curr });
            continue;
        }
        const prev = merged[merged.length - 1];
        if (Number.isFinite(prev.endMs) && Number.isFinite(curr.startMs) && (curr.startMs - prev.endMs) < thresholdMs) {
            prev.endMs = Math.max(prev.endMs, curr.endMs);
            prev.durationMs = prev.endMs - prev.startMs;
        } else {
            merged.push({ ...curr });
        }
    }

    return merged;
}

export function buildArcFeature(anglesEastRef, circle, circleIndex) {
    const coords = [];
    let prev = null;
    for (let k = 0; k < anglesEastRef.length; k++) {
        let ang = anglesEastRef[k];
        if (prev !== null) {
            let d = ang - prev;
            if (d > Math.PI) ang -= 2 * Math.PI;
            else if (d < -Math.PI) ang += 2 * Math.PI;
        }
        prev = ang;
        const bearingFromNorth = (Math.PI / 2) - ang;
        let b = bearingFromNorth % (2 * Math.PI);
        if (b < 0) b += 2 * Math.PI;
        coords.push(bearingToCoordinate(circle.center, circle.radius, b));
    }
    return {
        type: 'Feature',
        properties: { toiId: circleIndex, quality: circle.quality, radius: circle.radius },
        geometry: { type: 'LineString', coordinates: coords }
    };
}

export function computeOnStationArcs(points, circles) {
    const features = [];
    for (let idx = 0; idx < circles.length; idx++) {
        const c = circles[idx];
        const radius = c.radius;
        const lower = radius * 0.5;
        const upper = radius * 1.5;
        const startIdx = Math.max(0, Math.min(points.length - 1, c.startIndex ?? 0));
        const endIdxExclusive = Math.max(startIdx + 1, Math.min(points.length, c.endIndex ?? points.length));

        let currentAngles = [];
        let lastAng = null;

        for (let i = startIdx; i < endIdxExclusive; i++) {
            const p = points[i];
            const r = distance(c.center, p);
            if (r >= lower && r <= upper) {
                const ang = Math.atan2(p.lat - c.center.lat, p.lon - c.center.lon);
                if (lastAng !== null) {
                    const d = Math.abs(angleDiff(ang, lastAng));
                    if (d > Math.PI / 2) {
                        if (currentAngles.length >= 2) {
                            features.push(buildArcFeature(currentAngles, c, idx));
                        }
                        currentAngles = [];
                    }
                }
                currentAngles.push(ang);
                lastAng = ang;
            } else {
                if (currentAngles.length >= 2) {
                    const arcFeature = buildArcFeature(currentAngles, c, idx);
                    arcFeature.properties.startMs = points[startIdx]?.timeMs;
                    arcFeature.properties.endMs = points[Math.max(startIdx, Math.min(points.length - 1, i - 1))]?.timeMs;
                    features.push(arcFeature);
                }
                currentAngles = [];
                lastAng = null;
            }
        }
        if (currentAngles.length >= 2) {
            const arcFeature = buildArcFeature(currentAngles, c, idx);
            arcFeature.properties.startMs = points[startIdx]?.timeMs;
            arcFeature.properties.endMs = points[Math.max(startIdx, Math.min(points.length - 1, endIdxExclusive - 1))]?.timeMs;
            features.push(arcFeature);
        }
    }
    return { type: 'FeatureCollection', features };
}

export function computeOnStationFlightSegments(points, circles) {
    const features = [];
    for (let idx = 0; idx < circles.length; idx++) {
        const c = circles[idx];
        const radius = c.radius;
        const lower = radius * 0.5;
        const upper = radius * 1.5;
        const startIdx = Math.max(0, Math.min(points.length - 1, c.startIndex ?? 0));
        const endIdxExclusive = Math.max(startIdx + 1, Math.min(points.length, c.endIndex ?? points.length));
        let run = [];
        let runStartIdx = undefined;
        for (let i = startIdx; i < endIdxExclusive; i++) {
            const p = points[i];
            const r = distance(c.center, p);
            const on = r >= lower && r <= upper;
            if (on) {
                if (run.length === 0) runStartIdx = i;
                run.push([p.lon, p.lat]);
            } else if (run.length >= 2) {
                const startMs = Number.isFinite(points[runStartIdx]?.timeMs) ? points[runStartIdx].timeMs : undefined;
                const endMs = Number.isFinite(points[i - 1]?.timeMs) ? points[i - 1].timeMs : undefined;
                features.push({
                    type: 'Feature',
                    properties: { toiId: idx, quality: c.quality, startMs, endMs },
                    geometry: { type: 'LineString', coordinates: run }
                });
                run = [];
                runStartIdx = undefined;
            } else if (run.length === 1) {
                run = [];
                runStartIdx = undefined;
            }
        }
        if (run.length >= 2) {
            const startMs = Number.isFinite(points[runStartIdx]?.timeMs) ? points[runStartIdx].timeMs : undefined;
            const endMs = Number.isFinite(points[endIdxExclusive - 1]?.timeMs) ? points[endIdxExclusive - 1].timeMs : undefined;
            features.push({
                type: 'Feature',
                properties: { toiId: idx, quality: c.quality, startMs, endMs },
                geometry: { type: 'LineString', coordinates: run }
            });
        }
    }
    return { type: 'FeatureCollection', features };
}

// Convenience: end-to-end analysis from raw KML text
export function analyzeKMLText(kmlText, windowSizes = [20, 40, 80, 160, 320, 640, 1280]) {
    const coords = parseKML(kmlText);
    const circles = analyzeCirclesMulti(coords, windowSizes);
    const toiCentersGeoJSON = {
        type: 'FeatureCollection',
        features: circles.map((c, i) => ({
            type: 'Feature',
            properties: {
                id: i,
                title: `TOI ${i + 1}`,
                lat: c.center.lat,
                lon: c.center.lon,
                radius: c.radius,
                quality: c.quality,
                orbits: c.orbits || 0,
                startMs: c.startMs,
                endMs: c.endMs,
                durationMs: c.durationMs,
                sessions: c.sessions || [],
                totalOnStationMs: c.totalOnStationMs || 0
            },
            geometry: { type: 'Point', coordinates: [c.center.lon, c.center.lat] }
        }))
    };
    const toiCirclesGeoJSON = {
        type: 'FeatureCollection',
        features: circles.map(c => circlePolygon(c.center, c.radius))
    };
    const toiOnStationArcsGeoJSON = computeOnStationArcs(coords, circles);
    const flightOnStationGeoJSON = computeOnStationFlightSegments(coords, circles);
    return { coords, circles, toiCentersGeoJSON, toiCirclesGeoJSON, toiOnStationArcsGeoJSON, flightOnStationGeoJSON };
}

export default {
    parseKML,
    distance,
    findCircleCenter,
    detectCircles,
    mergeCircles,
    analyzeCircles,
    estimateOrbitCount,
    analyzeCirclesMulti,
    circlePolygon,
    bearingToCoordinate,
    angleDiff,
    computeOnStationSessions,
    buildArcFeature,
    computeOnStationArcs,
    computeOnStationFlightSegments,
    analyzeKMLText
};


