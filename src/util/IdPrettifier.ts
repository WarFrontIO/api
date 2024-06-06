import Sqids from "sqids";

const sqids = new Sqids({
	minLength: 6,
	alphabet: process.env.ID_CHARS
});

export function prettifyId(id: number): string {
	return sqids.encode([id]);
}

export function unprettifyId(id: string): number | undefined {
	const decoded = sqids.decode(id);
	if (decoded.length !== 1) {
		return undefined;
	}
	return decoded[0];
}