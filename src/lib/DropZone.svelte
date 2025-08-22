<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	const dispatch = createEventDispatcher<{ file: File }>();
	let fileInput: HTMLInputElement;

	function openDialog() {
		fileInput?.click();
	}

	function onChange(event: Event) {
		const files = (event.target as HTMLInputElement).files;
		if (files && files[0]) {
			dispatch('file', files[0]);
		}
	}

	function onDrop(e: DragEvent) {
		e.preventDefault();
		const files = e.dataTransfer?.files;
		if (files && files[0]) {
			dispatch('file', files[0]);
		}
	}

	function onDragOver(e: DragEvent) {
		e.preventDefault();
	}
</script>

<div
	class="cursor-pointer rounded-xl border-2 border-dashed border-indigo-400 bg-indigo-50 p-4 text-center transition hover:bg-indigo-100"
	on:click={openDialog}
	on:drop={onDrop}
	on:dragover={onDragOver}
>
	<div class="flex flex-col items-center">
		<svg class="mb-2 h-10 w-10 fill-indigo-400" viewBox="0 0 24 24">
			<path
				d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z"
			/>
		</svg>
		<h3 class="mb-1 text-sm font-medium text-gray-800">Drop KML file</h3>
		<p class="text-xs text-gray-600">or click to upload</p>
	</div>
	<input type="file" accept=".kml" class="hidden" bind:this={fileInput} on:change={onChange} />
</div>
