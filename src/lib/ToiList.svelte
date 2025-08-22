<script lang="ts">
	import { analyzeKMLText } from '$lib/kmlCircleAnalyzer';

	type Circle = ReturnType<typeof analyzeKMLText>['circles'][number];
	let { circles, onSelect } = $props<{ circles: Circle[]; onSelect: (idx: number) => void }>();

	function formatTimestamp(ms: number | undefined) {
		if (!ms) return '—';
		return new Date(ms).toLocaleString();
	}
	function formatDuration(ms: number | undefined) {
		if (!ms) return '—';
		const s = Math.floor(ms / 1000);
		const m = Math.floor(s / 60);
		const h = Math.floor(m / 60);
		return `${h}h ${m % 60}m ${s % 60}s`;
	}
</script>

<div class="space-y-4 overflow-y-auto">
	{#each circles as c, i (i)}
		<div
			class="cursor-pointer rounded-lg border p-4 shadow-sm hover:bg-gray-50"
			onclick={() => onSelect(i)}
		>
			<h3 class="mb-1 font-semibold">TOI {i + 1}</h3>
			<p class="text-sm text-gray-600">Quality: {c.quality}</p>
			<p class="text-sm text-gray-600">Radius: {Math.round(c.radius)} m</p>
			<p class="text-sm text-gray-600">Orbits: {c.orbits ?? 0}</p>
			<p class="text-sm text-gray-600">Start: {formatTimestamp(c.startMs)}</p>
			<p class="text-sm text-gray-600">End: {formatTimestamp(c.endMs)}</p>
			<p class="text-sm text-gray-600">Duration: {formatDuration(c.durationMs)}</p>
			{#if c.sessions && c.sessions.length > 0}
				<table class="mt-2 w-full text-sm">
					<thead>
						<tr class="text-left">
							<th class="pr-2">Start</th>
							<th class="pr-2">End</th>
							<th>Duration</th>
						</tr>
					</thead>
					<tbody>
						{#each c.sessions as s, j (j)}
							<tr>
								<td class="pr-2">{formatTimestamp(s.startMs)}</td>
								<td class="pr-2">{formatTimestamp(s.endMs)}</td>
								<td>{formatDuration(s.durationMs)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			{/if}
		</div>
	{/each}
</div>
