<script lang="ts">
	/* eslint-disable svelte/valid-prop-names-in-kit-pages, @typescript-eslint/no-explicit-any */
	export const ssr = false;

	import { onMount } from 'svelte';
	import maplibregl from 'maplibre-gl';
	import 'maplibre-gl/dist/maplibre-gl.css';
	import DropZone from '$lib/DropZone.svelte';
	import Results from '$lib/Results.svelte';
	import {
		parseKML,
		analyzeCirclesMulti,
		circlePolygon,
		computeOnStationArcs,
		computeOnStationFlightSegments,
		DEFAULT_TOLERANCES
	} from '$lib/kmlCircleAnalyzer';
	import type { Circle, Coord } from '$lib/types';

	let map: maplibregl.Map | null = null;
	let mapLoaded = false;
	let basemap: 'osm' | 'esri' = 'osm';
	let detectedCircles: Circle[] = [];
	let loading = false;
	let error = '';
	let resultsVisible = false;

	// Detection tolerances ("slop") — adjustable live via sliders. gapMax is edited
	// in degrees in the UI and converted to radians for the analyzer at the single
	// detection seam (runDetection).
	const GAP_MAX_DEG_DEFAULT = (DEFAULT_TOLERANCES.gapMax * 180) / Math.PI;
	let covMax = DEFAULT_TOLERANCES.covMax;
	let aspectMax = DEFAULT_TOLERANCES.aspectMax;
	let gapMaxDeg = GAP_MAX_DEG_DEFAULT;
	// Parsed track from the last loaded file, reused when a slider re-runs detection
	// so we never re-parse the KML on every drag.
	let lastCoords: Coord[] | null = null;

	const geo = {
		flight: { type: 'FeatureCollection', features: [] as any[] },
		toiCenters: { type: 'FeatureCollection', features: [] as any[] },
		toiCircles: { type: 'FeatureCollection', features: [] as any[] },
		toiOnStationArcs: { type: 'FeatureCollection', features: [] as any[] },
		flightOnStation: { type: 'FeatureCollection', features: [] as any[] },
		sessionArcHighlight: { type: 'FeatureCollection', features: [] as any[] },
		sessionFlightHighlight: { type: 'FeatureCollection', features: [] as any[] }
	};

	let mapDiv: HTMLDivElement;

	onMount(() => {
		window.addEventListener('resize', () => map?.resize());
		// Initialize map immediately so it's visible before loading any KML
		initMap(0, 0);
	});

	function showError(message: string) {
		error = message;
		setTimeout(() => (error = ''), 5000);
	}

	function processFile(file: File) {
		if (!file.name.toLowerCase().endsWith('.kml')) {
			showError('Please upload a KML file');
			return;
		}
		const reader = new FileReader();
		loading = true;
		reader.onload = (e) => {
			try {
				analyzeKML(String(e.target?.result));
			} catch (err) {
				showError('Error processing KML file: ' + (err as Error).message);
				loading = false;
			}
		};
		reader.readAsText(file);
	}

	function initMap(centerLon: number, centerLat: number) {
		if (map) return;
		mapDiv.classList.remove('hidden');
		map = new maplibregl.Map({
			container: mapDiv,
			center: [centerLon, centerLat],
			zoom: 2,
			style: {
				version: 8,
				sources: {
					osm: {
						type: 'raster',
						tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
						tileSize: 256,
						attribution: '© OpenStreetMap contributors'
					},
					esri: {
						type: 'raster',
						tiles: [
							'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
						],
						tileSize: 256,
						attribution:
							'Source: Esri — Esri, Maxar, Earthstar Geographics, and the GIS User Community'
					}
				},
				layers: [
					{
						id: 'osm-tiles',
						type: 'raster',
						source: 'osm',
						minzoom: 0,
						maxzoom: 19,
						layout: { visibility: 'visible' }
					},
					{
						id: 'esri-tiles',
						type: 'raster',
						source: 'esri',
						minzoom: 0,
						maxzoom: 19,
						layout: { visibility: 'none' }
					}
				]
			},
			attributionControl: true
		});

		map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');

		map.on('load', () => {
			addDataSourcesAndLayers();
			mapLoaded = true;
			setTimeout(() => map?.resize(), 0);
		});
	}

	function addDataSourcesAndLayers() {
		if (!map) return;
		map.addSource('flight', { type: 'geojson', data: geo.flight });
		map.addSource('toi-centers', { type: 'geojson', data: geo.toiCenters });
		map.addSource('toi-circles', { type: 'geojson', data: geo.toiCircles });
		map.addSource('toi-onstation', { type: 'geojson', data: geo.toiOnStationArcs });
		map.addSource('flight-onstation', { type: 'geojson', data: geo.flightOnStation });
		map.addSource('session-arc-hl', { type: 'geojson', data: geo.sessionArcHighlight });
		map.addSource('session-flight-hl', { type: 'geojson', data: geo.sessionFlightHighlight });

		// --- Actual GPS track: solid, cool blues ---
		map.addLayer({
			id: 'flight-line',
			type: 'line',
			source: 'flight',
			paint: { 'line-color': '#2563eb', 'line-width': 2, 'line-opacity': 0.6 }
		});

		map.addLayer({
			id: 'flight-onstation',
			type: 'line',
			source: 'flight-onstation',
			paint: { 'line-color': '#06b6d4', 'line-width': 3, 'line-opacity': 0.95 }
		});

		// --- Idealized / fitted geometry: dashed, warm oranges (reads as computed, not measured) ---
		map.addLayer({
			id: 'toi-circles-fill',
			type: 'fill',
			source: 'toi-circles',
			paint: { 'fill-color': '#f97316', 'fill-opacity': 0.08 }
		});

		map.addLayer({
			id: 'toi-circles-outline',
			type: 'line',
			source: 'toi-circles',
			paint: {
				'line-color': '#f97316',
				'line-width': 1.5,
				'line-opacity': 0.7,
				'line-dasharray': [2, 2]
			}
		});

		map.addLayer({
			id: 'toi-onstation-arcs',
			type: 'line',
			source: 'toi-onstation',
			paint: {
				'line-color': '#ea580c',
				'line-width': 2.5,
				'line-opacity': 0.9,
				'line-dasharray': [2, 2]
			}
		});

		map.addLayer({
			id: 'toi-centers-circles',
			type: 'circle',
			source: 'toi-centers',
			paint: {
				'circle-radius': 6,
				'circle-stroke-color': '#ffffff',
				'circle-stroke-width': 2,
				'circle-color': [
					'match',
					['get', 'quality'],
					'high',
					'#28a745',
					'medium',
					'#ffc107',
					/* other */ '#dc3545'
				],
				'circle-opacity': 0.9
			}
		});

		// --- Selected-session highlight: magenta, distinct from both the blue (actual) and
		// orange (idealized) families so the chosen session pops without ambiguity ---
		map.addLayer({
			id: 'session-flight-hl',
			type: 'line',
			source: 'session-flight-hl',
			paint: { 'line-color': '#ec4899', 'line-width': 6, 'line-opacity': 0.95 }
		});

		map.addLayer({
			id: 'session-arc-hl',
			type: 'line',
			source: 'session-arc-hl',
			paint: {
				'line-color': '#be185d',
				'line-width': 6,
				'line-opacity': 0.95,
				'line-dasharray': [2, 2]
			}
		});

		map.on('click', 'toi-centers-circles', (e) => {
			const f: any = e.features?.[0];
			if (!f) return;
			const p = f.properties;
			const html = `
        <strong>${p.title || 'TOI'}</strong><br>
        Lat: ${Number(p.lat).toFixed(6)}<br>
        Lon: ${Number(p.lon).toFixed(6)}<br>
        Radius: ${Number(p.radius).toFixed(0)}m<br>
        Quality: ${p.quality}<br>
        Orbits: ${Number(p.orbits || 0).toFixed(1)}<br>
        Overall Start: ${formatTimestamp(Number(p.startMs))}<br>
        Overall End: ${formatTimestamp(Number(p.endMs))}<br>
        Total On-Station: ${formatDuration(Number(p.totalOnStationMs))}<br>
      `;
			new maplibregl.Popup({ offset: 10 })
				.setLngLat([Number(p.lon), Number(p.lat)])
				.setHTML(html)
				.addTo(map!);
		});

		map.on('mouseenter', 'toi-centers-circles', () => {
			map!.getCanvas().style.cursor = 'pointer';
		});
		map.on('mouseleave', 'toi-centers-circles', () => {
			map!.getCanvas().style.cursor = '';
		});
	}

	$: if (map && mapLoaded) {
		map.setLayoutProperty('osm-tiles', 'visibility', basemap === 'osm' ? 'visible' : 'none');
		map.setLayoutProperty('esri-tiles', 'visibility', basemap === 'esri' ? 'visible' : 'none');
	}

	function updateDataOnMap() {
		if (!map || !map.isStyleLoaded()) return;
		(map.getSource('flight') as maplibregl.GeoJSONSource).setData(geo.flight);
		(map.getSource('toi-centers') as maplibregl.GeoJSONSource).setData(geo.toiCenters);
		(map.getSource('toi-circles') as maplibregl.GeoJSONSource).setData(geo.toiCircles);
		(map.getSource('toi-onstation') as maplibregl.GeoJSONSource).setData(geo.toiOnStationArcs);
		(map.getSource('flight-onstation') as maplibregl.GeoJSONSource).setData(geo.flightOnStation);
		(map.getSource('session-arc-hl') as maplibregl.GeoJSONSource).setData(geo.sessionArcHighlight);
		(map.getSource('session-flight-hl') as maplibregl.GeoJSONSource).setData(
			geo.sessionFlightHighlight
		);
	}

	function highlightSession(toiIndex: number, sessionIndex: number) {
		if (!map || !detectedCircles[toiIndex] || !detectedCircles[toiIndex].sessions) return;
		const circle = detectedCircles[toiIndex];
		const session = circle.sessions![sessionIndex];
		const sMs = session.startMs;
		const eMs = session.endMs;
		const arcFeatures = (geo.toiOnStationArcs.features || []).filter(
			(f: any) =>
				f.properties &&
				f.properties.toiId === toiIndex &&
				Number.isFinite(f.properties.startMs) &&
				Number.isFinite(f.properties.endMs) &&
				f.properties.startMs <= eMs &&
				f.properties.endMs >= sMs
		);
		const flightFeatures = (geo.flightOnStation.features || []).filter(
			(f: any) =>
				f.properties &&
				f.properties.toiId === toiIndex &&
				Number.isFinite(f.properties.startMs) &&
				Number.isFinite(f.properties.endMs) &&
				f.properties.startMs <= eMs &&
				f.properties.endMs >= sMs
		);
		geo.sessionArcHighlight = { type: 'FeatureCollection', features: arcFeatures };
		geo.sessionFlightHighlight = { type: 'FeatureCollection', features: flightFeatures };
		if (map.getSource('session-arc-hl'))
			(map.getSource('session-arc-hl') as maplibregl.GeoJSONSource).setData(
				geo.sessionArcHighlight
			);
		if (map.getSource('session-flight-hl'))
			(map.getSource('session-flight-hl') as maplibregl.GeoJSONSource).setData(
				geo.sessionFlightHighlight
			);
	}

	function clearSessionHighlight() {
		geo.sessionArcHighlight = { type: 'FeatureCollection', features: [] };
		geo.sessionFlightHighlight = { type: 'FeatureCollection', features: [] };
		if (map && map.isStyleLoaded()) {
			(map.getSource('session-arc-hl') as maplibregl.GeoJSONSource).setData(
				geo.sessionArcHighlight
			);
			(map.getSource('session-flight-hl') as maplibregl.GeoJSONSource).setData(
				geo.sessionFlightHighlight
			);
		}
	}

	function computeBoundsFromLineString(lineCoords: number[][]): maplibregl.LngLatBoundsLike {
		let minX = Infinity,
			minY = Infinity,
			maxX = -Infinity,
			maxY = -Infinity;
		for (const [x, y] of lineCoords) {
			if (x < minX) minX = x;
			if (y < minY) minY = y;
			if (x > maxX) maxX = x;
			if (y > maxY) maxY = y;
		}
		return [
			[minX, minY],
			[maxX, maxY]
		];
	}

	function focusOnTOI(index: number) {
		if (!map || !detectedCircles[index]) return;
		const c = detectedCircles[index];
		const size = map.getContainer().getBoundingClientRect();
		const paddingRatio = 0.6;
		const pixelSpan = Math.min(size.width, size.height) * paddingRatio;
		const diameterMeters = c.radius * 2;
		const latRad = (c.center.lat * Math.PI) / 180;
		const initialRes = 156543.03392804097;
		let zoom = Math.log2((initialRes * Math.cos(latRad)) / (diameterMeters / pixelSpan));
		zoom = Math.max(map.getMinZoom(), Math.min(map.getMaxZoom() ?? 22, zoom));
		map.flyTo({ center: [c.center.lon, c.center.lat], zoom });
	}

	function formatTimestamp(ms: number): string {
		if (!Number.isFinite(ms)) return '—';
		try {
			return new Date(ms).toLocaleString();
		} catch {
			return '—';
		}
	}

	function formatDuration(ms: number): string {
		if (!Number.isFinite(ms)) return '—';
		const totalSec = Math.max(0, Math.round(ms / 1000));
		const days = Math.floor(totalSec / 86400);
		const hours = Math.floor((totalSec % 86400) / 3600);
		const minutes = Math.floor((totalSec % 3600) / 60);
		const seconds = totalSec % 60;
		return `${days.toString().padStart(2, '0')}:${hours
			.toString()
			.padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds
			.toString()
			.padStart(2, '0')}`;
	}

	function analyzeKML(kmlText: string) {
		error = '';
		try {
			const coords = parseKML(kmlText) as Coord[];
			if (coords.length < 50) {
				throw new Error('Insufficient data points in KML file');
			}
			lastCoords = coords;
			runDetection(coords, true);
		} catch (err) {
			showError('Error analyzing KML: ' + (err as Error).message);
		} finally {
			loading = false;
		}
	}

	// Detect circles on already-parsed coords and render them. `fit` re-fits the map
	// to the track (first load only); slider-driven re-runs keep the current view.
	function runDetection(coords: Coord[], fit: boolean) {
		const tolerances = {
			covMax,
			aspectMax,
			gapMax: (gapMaxDeg * Math.PI) / 180
		};
		const circles = analyzeCirclesMulti(coords, undefined, tolerances) as Circle[];
		detectedCircles = circles;

		const centerLat = coords.reduce((s, p) => s + p.lat, 0) / coords.length;
		const centerLon = coords.reduce((s, p) => s + p.lon, 0) / coords.length;
		initMap(centerLon, centerLat);

		geo.flight = {
			type: 'FeatureCollection',
			features: [
				{
					type: 'Feature',
					properties: {},
					geometry: { type: 'LineString', coordinates: coords.map((c) => [c.lon, c.lat]) }
				}
			]
		};

		geo.toiCenters = {
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

		geo.toiCircles = {
			type: 'FeatureCollection',
			features: circles.map((c) => circlePolygon(c.center, c.radius))
		};

		geo.toiOnStationArcs = computeOnStationArcs(coords, circles);
		geo.flightOnStation = computeOnStationFlightSegments(coords, circles);

		updateDataOnMap();

		if (fit) {
			const bounds = computeBoundsFromLineString(coords.map((c) => [c.lon, c.lat]));
			map!.fitBounds(bounds, { padding: 50, duration: 800 });
		}

		resultsVisible = true;
	}

	// Re-run detection on the already-loaded track when a tolerance slider changes,
	// keeping the current map view (no re-fit).
	function reanalyze() {
		if (lastCoords) runDetection(lastCoords, false);
	}

	function resetTolerances() {
		covMax = DEFAULT_TOLERANCES.covMax;
		aspectMax = DEFAULT_TOLERANCES.aspectMax;
		gapMaxDeg = GAP_MAX_DEG_DEFAULT;
		reanalyze();
	}
</script>

<div class="flex h-screen flex-col bg-white">
	<header class="bg-gradient-to-br from-indigo-500 to-purple-600 p-4 text-white">
		<h1 class="mb-1 text-xl">Aircraft TOI Analyzer</h1>
		<p class="text-sm opacity-90">Upload a KML flight track to find on-station orbits.</p>
	</header>

	<div class="flex min-h-0 flex-1 flex-col p-4">
		<div class="grid min-h-0 flex-1 grid-cols-[340px_1fr] gap-4">
			<div class="flex min-h-0 flex-col gap-4 overflow-hidden">
				<DropZone on:file={(e) => processFile(e.detail)} />
				{#if error}
					<div class="text-sm text-red-600">{error}</div>
				{/if}
				{#if resultsVisible}
					<div class="rounded border border-gray-200 p-3 text-xs">
						<div class="mb-2 flex items-center justify-between">
							<span class="font-semibold">Detection tolerance</span>
							<button
								type="button"
								class="text-indigo-600 hover:underline"
								onclick={resetTolerances}>Reset</button
							>
						</div>
						<label class="mb-2 block">
							<div class="flex justify-between">
								<span>Radius wobble</span>
								<span class="text-gray-500 tabular-nums">{(covMax * 100).toFixed(0)}%</span>
							</div>
							<input
								type="range"
								class="w-full"
								min="0.05"
								max="0.4"
								step="0.01"
								bind:value={covMax}
								oninput={reanalyze}
							/>
						</label>
						<label class="mb-2 block">
							<div class="flex justify-between">
								<span>Max elongation</span>
								<span class="text-gray-500 tabular-nums">{aspectMax.toFixed(1)}:1</span>
							</div>
							<input
								type="range"
								class="w-full"
								min="1.2"
								max="4"
								step="0.1"
								bind:value={aspectMax}
								oninput={reanalyze}
							/>
						</label>
						<label class="block">
							<div class="flex justify-between">
								<span>Max gap</span>
								<span class="text-gray-500 tabular-nums">{gapMaxDeg.toFixed(0)}°</span>
							</div>
							<input
								type="range"
								class="w-full"
								min="20"
								max="180"
								step="5"
								bind:value={gapMaxDeg}
								oninput={reanalyze}
							/>
						</label>
						<p class="mt-1 text-[11px] text-gray-400">
							Higher = looser fit, more circles detected.
						</p>
					</div>
					<Results
						circles={detectedCircles}
						onSelect={focusOnTOI}
						onSessionHover={(data: { toiIdx: number; sessionIdx: number }) =>
							highlightSession(data.toiIdx, data.sessionIdx)}
						onSessionLeave={clearSessionHighlight}
					/>
				{/if}
			</div>
			<div class="relative h-full overflow-hidden">
				<div class="absolute top-2 left-2 z-10 space-y-1 rounded bg-white p-2 text-xs shadow">
					<div class="font-semibold">Base map</div>
					<label class="flex items-center gap-1"
						><input type="radio" value="osm" bind:group={basemap} /> OpenStreetMap</label
					>
					<label class="flex items-center gap-1"
						><input type="radio" value="esri" bind:group={basemap} /> Esri World Imagery</label
					>
				</div>
				{#if resultsVisible}
					<div
						class="absolute bottom-2 left-2 z-10 space-y-1.5 rounded bg-white p-2 text-xs shadow"
					>
						<div class="font-semibold">Legend</div>
						<div class="font-medium text-gray-500">Actual track</div>
						<div class="flex items-center gap-2">
							<span class="inline-block h-0 w-6 border-t-2" style="border-color:#2563eb"></span>
							<span>Flight path</span>
						</div>
						<div class="flex items-center gap-2">
							<span class="inline-block h-0 w-6 border-t-[3px]" style="border-color:#06b6d4"></span>
							<span>On-station (circling)</span>
						</div>
						<div class="mt-1 font-medium text-gray-500">Detected circle (idealized)</div>
						<div class="flex items-center gap-2">
							<span
								class="inline-block h-0 w-6 border-t-2 border-dashed"
								style="border-color:#ea580c"
							></span>
							<span>Fitted arc</span>
						</div>
						<div class="flex items-center gap-2">
							<span
								class="inline-block h-0 w-6 border-t-2 border-dashed"
								style="border-color:#f97316"
							></span>
							<span>Fitted circle</span>
						</div>
						<div class="flex items-center gap-2">
							<span
								class="inline-block h-3 w-3 rounded-full border-2 border-white"
								style="background:#28a745;box-shadow:0 0 0 1px #ccc"
							></span>
							<span>Center (color = quality)</span>
						</div>
						<div class="mt-1 font-medium text-gray-500">Selected session</div>
						<div class="flex items-center gap-2">
							<span class="inline-block h-0 w-6 border-t-[3px]" style="border-color:#ec4899"></span>
							<span>Highlighted</span>
						</div>
					</div>
				{/if}
				{#if loading}
					<div class="absolute inset-0 flex flex-col items-center justify-center bg-white/80">
						<svg
							class="h-12 w-12 animate-spin text-indigo-500"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
						>
							<circle cx="12" cy="12" r="10" class="opacity-25" />
							<path d="M12 2a10 10 0 0 1 10 10" class="opacity-75" />
						</svg>
						<p class="mt-2 text-indigo-600">Analyzing flight patterns...</p>
					</div>
				{/if}
				<div bind:this={mapDiv} class="hidden h-full rounded-lg"></div>
			</div>
		</div>
	</div>
</div>
