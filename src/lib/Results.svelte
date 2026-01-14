<script lang="ts">
	import type { Circle } from '$lib/types';
	
	let { 
		circles = [],
		onSelect,
		onSessionHover,
		onSessionLeave
	}: {
		circles?: Circle[];
		onSelect?: (idx: number) => void;
		onSessionHover?: (data: { toiIdx: number; sessionIdx: number }) => void;
		onSessionLeave?: () => void;
	} = $props();

	function select(idx: number) {
		onSelect?.(idx);
	}

	function hover(toiIdx: number, sessionIdx: number) {
		onSessionHover?.({ toiIdx, sessionIdx });
	}

	function leave() {
		onSessionLeave?.();
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
		return `${days.toString().padStart(2, '0')}:${hours
			.toString()
			.padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
	}

	function formatDate(ms: number | undefined): string {
		if (!Number.isFinite(ms as number)) return '—';
		try {
			return new Date(ms as number).toLocaleDateString();
		} catch {
			return '—';
		}
	}

	function getQualityLabel(quality: string): string {
		switch (quality?.toLowerCase()) {
			case 'high':
				return 'High';
			case 'medium':
				return 'Med';
			case 'low':
				return 'Low';
			default:
				return '';
		}
	}

	function getQualityDotClass(quality: string): string {
		switch (quality?.toLowerCase()) {
			case 'high':
				return 'bg-green-500';
			case 'medium':
				return 'bg-yellow-500';
			case 'low':
				return 'bg-red-500';
			default:
				return 'bg-indigo-500';
		}
	}
</script>

{#if circles.length === 0}
	<div class="flex h-32 items-center justify-center">
		<p class="text-center text-gray-600">No circling patterns detected</p>
	</div>
{:else}
	<div class="toi-list max-h-full overflow-y-auto">
		<div class="grid gap-3 p-1">
			{#each circles as circle, idx (idx)}
				<div
					class="toi-item grid cursor-pointer grid-cols-[auto_1fr] gap-4 rounded-lg border border-indigo-200 bg-indigo-50 p-3 transition-all duration-200 hover:border-indigo-300 hover:shadow-md"
					data-toi-index={idx}
					role="button"
					tabindex="0"
					onclick={() => select(idx)}
					onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && select(idx)}
				>
					<!-- TOI Number and Quality Indicator -->
					<div class="toi-badge grid place-items-center gap-1">
						<div class="flex h-10 w-10 items-center justify-center rounded-full bg-white shadow-sm">
							<span class="text-sm font-bold text-gray-800">{idx + 1}</span>
						</div>
						<div class={`h-2 w-2 rounded-full ${getQualityDotClass(circle.quality)}`}></div>
						{#if getQualityLabel(circle.quality)}
							<span class="text-[9px] font-medium leading-none text-gray-600">
								{getQualityLabel(circle.quality)}
							</span>
						{/if}
					</div>

					<!-- TOI Information -->
					<div class="toi-content min-w-0">
						<!-- Primary Info Grid -->
						<div class="mb-3 grid grid-cols-1 gap-2">
							<div class="font-mono text-sm font-semibold text-gray-800">
								{circle.center.lat.toFixed(6)}, {circle.center.lon.toFixed(6)}
							</div>
							
							<div class="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-700">
								<div class="grid grid-cols-[auto_1fr] gap-1">
									<span class="font-medium text-gray-500">Date:</span>
									<span>{formatDate(circle.startMs)}</span>
								</div>
								<div class="grid grid-cols-[auto_1fr] gap-1">
									<span class="font-medium text-gray-500">Orbits:</span>
									<span>{(circle.orbits ?? 0).toFixed(1)}</span>
								</div>
								<div class="grid grid-cols-[auto_1fr] gap-1">
									<span class="font-medium text-gray-500">Duration:</span>
									<span>{formatDuration((circle.totalOnStationMs ?? circle.durationMs ?? 0) as number)}</span>
								</div>
								<div class="grid grid-cols-[auto_1fr] gap-1">
									<span class="font-medium text-gray-500">Radius:</span>
									<span>{circle.radius.toFixed(0)}m</span>
								</div>
							</div>
						</div>

						<!-- Sessions Table -->
						{#if circle.sessions?.length}
							<div class="border-t border-indigo-200 pt-2">
								<div class="mb-1 text-xs font-medium text-gray-600">Session Details</div>
								<div class="grid gap-1">
									<div class="grid grid-cols-3 gap-2 text-[10px] font-medium text-gray-500">
										<div>Start</div>
										<div>End</div>
										<div>Duration</div>
									</div>
									{#each circle.sessions as s, i (i)}
										<div
											data-session-index={i}
											class="grid grid-cols-3 gap-2 rounded px-1 py-0.5 text-[10px] text-gray-700 transition-colors hover:bg-indigo-100"
											role="row"
											tabindex="0"
											onmouseenter={() => hover(idx, i)}
											onmouseleave={leave}
										>
											<div class="font-mono">{formatTime(s.startMs)}</div>
											<div class="font-mono">{formatTime(s.endMs)}</div>
											<div class="font-mono">{formatDuration(s.durationMs)}</div>
										</div>
									{/each}
								</div>
							</div>
						{/if}
					</div>
				</div>
			{/each}
		</div>
	</div>
{/if}
