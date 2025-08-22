<script lang="ts">
	import maplibregl from 'maplibre-gl';
	import type { Map as MaplibreMap, GeoJSONSource } from 'maplibre-gl';
	import { onMount } from 'svelte';
	import { analyzeKMLText } from '$lib/kmlCircleAnalyzer';

	type AnalysisResult = ReturnType<typeof analyzeKMLText>;
	let { data } = $props<{ data: AnalysisResult | null }>();
	let mapContainer: HTMLDivElement;
	let map: MaplibreMap | null = null;
	let baseLayer = $state<'osm' | 'esri'>('osm');

	onMount(() => {
		map = new maplibregl.Map({
			container: mapContainer,
			center: [0, 0],
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
							'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
						],
						tileSize: 256,
						attribution:
							'Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community'
					}
				},
				layers: [
					{ id: 'base-osm', type: 'raster', source: 'osm', layout: { visibility: 'visible' } },
					{ id: 'base-esri', type: 'raster', source: 'esri', layout: { visibility: 'none' } }
				]
			}
		});
		map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
		map.on('load', () => {
			updateSources();
			updateBaseLayerVisibility();
		});
	});

	$effect(() => {
		if (map && data) {
			updateSources();
			if (data.coords && data.coords.length > 0) {
				const bounds = data.coords.reduce(
					(b: maplibregl.LngLatBounds, p: { lon: number; lat: number }) => b.extend([p.lon, p.lat]),
					new maplibregl.LngLatBounds(
						[data.coords[0].lon, data.coords[0].lat],
						[data.coords[0].lon, data.coords[0].lat]
					)
				);
				map.fitBounds(bounds, { padding: 40 });
			}
		}
	});

	function addOrUpdateSource(id: string, geojson: GeoJSON.FeatureCollection) {
		if (!map) return;
		const src = map.getSource(id) as GeoJSONSource | undefined;
		if (src) {
			src.setData(geojson);
		} else {
			map.addSource(id, { type: 'geojson', data: geojson });
		}
	}

	function updateSources() {
		if (!map || !data) return;
		addOrUpdateSource('flight', data.flight);
		addOrUpdateSource('flight-onstation', data.flightOnStationGeoJSON);
		addOrUpdateSource('toi-centers', data.toiCentersGeoJSON);
		addOrUpdateSource('toi-circles', data.toiCirclesGeoJSON);
		addOrUpdateSource('toi-arcs', data.toiOnStationArcsGeoJSON);

		if (!map.getLayer('flight-line')) {
			map.addLayer({
				id: 'flight-line',
				type: 'line',
				source: 'flight',
				paint: { 'line-color': '#667eea', 'line-width': 2 }
			});
			map.addLayer({
				id: 'flight-onstation',
				type: 'line',
				source: 'flight-onstation',
				paint: { 'line-color': '#28a745', 'line-width': 3 }
			});
			map.addLayer({
				id: 'toi-circles-fill',
				type: 'fill',
				source: 'toi-circles',
				paint: { 'fill-color': '#667eea', 'fill-opacity': 0.08 }
			});
			map.addLayer({
				id: 'toi-circles-outline',
				type: 'line',
				source: 'toi-circles',
				paint: { 'line-color': '#667eea', 'line-width': 1 }
			});
			map.addLayer({
				id: 'toi-arcs',
				type: 'line',
				source: 'toi-arcs',
				paint: { 'line-color': '#28a745', 'line-width': 3 }
			});
			map.addLayer({
				id: 'toi-centers',
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
						'#dc3545'
					]
				}
			});
		}
	}

	function updateBaseLayerVisibility() {
		if (!map) return;
		const hasOSM = !!map.getLayer('base-osm');
		const hasESRI = !!map.getLayer('base-esri');
		if (!hasOSM || !hasESRI) return;
		const showEsri = baseLayer === 'esri';
		map.setLayoutProperty('base-osm', 'visibility', showEsri ? 'none' : 'visible');
		map.setLayoutProperty('base-esri', 'visibility', showEsri ? 'visible' : 'none');
	}

	$effect(() => {
		// re-run when baseLayer changes
		void baseLayer;
		updateBaseLayerVisibility();
	});

	export function focusOnToi(index: number) {
		if (!map || !data) return;
		const c = data.circles[index];
		if (c) {
			map.flyTo({ center: [c.center.lon, c.center.lat], zoom: 13 });
		}
	}
</script>

<div class="relative h-full w-full">
	<div class="absolute left-2 top-2 z-10 space-y-1 rounded bg-white p-2 text-xs shadow">
		<div class="font-semibold">Base map</div>
		<label class="flex items-center gap-1"
			><input type="radio" value="osm" bind:group={baseLayer} /> OpenStreetMap</label
		>
		<label class="flex items-center gap-1"
			><input type="radio" value="esri" bind:group={baseLayer} /> Esri World Imagery</label
		>
	</div>
	<div bind:this={mapContainer} class="h-full w-full"></div>
</div>
