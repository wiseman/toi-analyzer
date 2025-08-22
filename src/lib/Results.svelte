<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import type { Circle } from '$lib/types';
	export let circles: Circle[] = [];
	const dispatch = createEventDispatcher<{
		select: number;
		sessionHover: { toiIdx: number; sessionIdx: number };
		sessionLeave: void;
	}>();

	function select(idx: number) {
		dispatch('select', idx);
	}

	function hover(toiIdx: number, sessionIdx: number) {
		dispatch('sessionHover', { toiIdx, sessionIdx });
	}

	function leave() {
		dispatch('sessionLeave');
	}

	function formatTime(ms: number): string {
		if (!Number.isFinite(ms)) return '—';
		return new Date(ms).toLocaleTimeString('en-GB', {
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit'
		});
	}

	function formatDuration(ms: number): string {
		if (!Number.isFinite(ms)) return '—';
		const totalSec = Math.max(0, Math.round(ms / 1000));
		const days = Math.floor(totalSec / 86400);
		const hours = Math.floor((totalSec % 86400) / 3600);
		const minutes = Math.floor((totalSec % 3600) / 60);
		const seconds = totalSec % 60;
		return `${days.toString().padStart(2, '0')}:${hours.toString().padStart(2, '0')}:${minutes
			.toString()
			.padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
	}
</script>

{#if circles.length === 0}
	<p class="text-center text-gray-600">No circling patterns detected</p>
{:else}
	<div class="toi-list grid gap-4 overflow-auto">
		{#each circles as circle, idx (idx)}
			<div
				class="toi-item cursor-pointer rounded-lg border border-indigo-200 bg-indigo-50 p-4 transition hover:shadow"
				data-toi-index={idx}
				on:click={() => select(idx)}
			>
				<div class="toi-header mb-3 flex items-center gap-4">
					<div
						class="toi-number flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 font-bold text-white"
					>
						{idx + 1}
					</div>
					<div class="toi-details grid gap-1">
						<div class="toi-coords font-mono text-sm font-semibold text-gray-800">
							{circle.center.lat.toFixed(6)}, {circle.center.lon.toFixed(6)}
						</div>
						<div class="text-sm text-gray-700">Radius: {circle.radius.toFixed(0)}m</div>
						<div class="text-sm text-gray-700">Orbits: {circle.orbits ?? 0}</div>
					</div>
				</div>
				{#if circle.sessions?.length}
					<table class="sessions-table w-full text-xs">
						<thead>
							<tr>
								<th class="text-left">Start</th>
								<th class="text-left">End</th>
								<th class="text-left">Duration</th>
							</tr>
						</thead>
						<tbody>
							{#each circle.sessions as s, i (i)}
								<tr
									data-session-index={i}
									class="cursor-default hover:bg-indigo-100"
									on:mouseenter={() => hover(idx, i)}
									on:mouseleave={leave}
								>
									<td>{formatTime(s.startMs)}</td>
									<td>{formatTime(s.endMs)}</td>
									<td>{formatDuration(s.durationMs)}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				{/if}
			</div>
		{/each}
	</div>
{/if}
