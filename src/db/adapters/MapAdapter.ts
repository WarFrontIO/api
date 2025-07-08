import {get, getAll, insert, run} from "../DataBaseManager";
import {brotliCompressSync, brotliDecompressSync} from "node:zlib";

run("CREATE TABLE IF NOT EXISTS map_data (id INTEGER NOT NULL AUTO_INCREMENT, entry INTEGER NOT NULL, version INTEGER NOT NULL, time INTEGER NOT NULL, data MEDIUMBLOB NOT NULL, PRIMARY KEY (id), KEY (entry));", []).catch(() => {});
run("CREATE TABLE IF NOT EXISTS map_entry (id INTEGER NOT NULL AUTO_INCREMENT, user_id INTEGER NOT NULL, name VARCHAR(255) NOT NULL, description VARCHAR(4095) NOT NULL, PRIMARY KEY (id), KEY (user_id));", []).catch(() => {});

/**
 * Stores a new map
 * @param userId The user that created the map
 * @param name The name of the map
 * @param description The description of the map
 * @returns map id
 */
export async function addMap(userId: number, name: string, description: string): Promise<number | undefined> {
	return await insert("INSERT INTO map_entry (user_id, name, description) VALUES (?, ?, ?);", [userId, name, description]).catch(() => undefined);
}

/**
 * Update map information for selected map
 * @param id The map to update
 * @param name The new map name
 * @param description The new map description
 */
export async function updateMap(id: number, name: string, description: string): Promise<void> {
	await run("UPDATE map_entry SET name = ?, description = ? WHERE id = ?;", [name, description, id]).catch(() => {});
}

/**
 * Upload a map version
 * @param entry The map entry to upload a map to
 * @param version The map codec version
 * @param data The raw map data
 * @returns The map data id
 */
export async function uploadMap(entry: number, version: number, data: Uint8Array): Promise<number | undefined> {
	const map = brotliCompressSync(data);
	return await insert("INSERT INTO map_data (entry, version, time, data) VALUES (?, ?, UNIX_TIMESTAMP(), ?);", [entry, version, map]).catch(() => undefined);
}

/**
 * Get a map entry
 * @param id The entry id
 * @returns Data associated with this map entry
 */
export async function getMapEntry(id: number): Promise<MapEntry | undefined> {
	return await get<MapEntry>("SELECT id, user_id, name, description FROM map_entry WHERE id = ?;", [id]).catch(() => undefined);
}

/**
 * Get map data for a specific id
 * @param id The map id
 * @returns The map data
 */
export async function getMapInfo(id: number): Promise<MapData | undefined> {
	return await get<MapData>("SELECT id, entry, version, time FROM map_data WHERE id = ?;", [id]).catch(() => undefined);
}

/**
 * Get map data for a specific id
 * @param id The map id
 * @returns The map data
 * @throws Error If the map failed to load
 */
export async function getMapData(id: number): Promise<Uint8Array | undefined> {
	const data = await get<{ data: Buffer }>("SELECT data FROM map_data WHERE id = ?;", [id]).catch(() => undefined);
	if (!data) {
		return undefined;
	}
	try {
		return brotliDecompressSync(data.data);
	} catch {
		throw new Error("Invalid map");
	}
}

/**
 * Get 5 map versions for a map entry
 * @param id The map entry id
 * @param offset The offset
 * @returns The map data entries
 */
export async function getVersions(id: number, offset: number): Promise<MinimalMapData[]> {
	return await getAll<MinimalMapData>("SELECT id, version, time FROM map_data WHERE entry = ? ORDER BY time DESC LIMIT 5 OFFSET ?;", [id, offset.toString()]).catch(() => []);
}

export type MapEntry = {
	id: number,
	user_id: number,
	name: string,
	description: string;
}
export type MapData = {
	id: number,
	entry: number,
	version: number,
	time: number
}
export type MinimalMapData = Omit<MapData, "entry">;