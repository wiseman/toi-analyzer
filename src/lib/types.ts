export interface Coord {
	lat: number;
	lon: number;
	alt?: number;
	timeMs?: number;
}

export interface Session {
	startMs: number;
	endMs: number;
	durationMs: number;
}

export interface Circle {
	center: Coord;
	radius: number;
	quality: string;
	orbits?: number;
	startMs?: number;
	endMs?: number;
	durationMs?: number;
	sessions?: Session[];
	totalOnStationMs?: number;
}
