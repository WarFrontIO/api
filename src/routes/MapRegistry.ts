import {route} from "../util/RouteBuilder.ts";
import {getMapData, getMapEntry, getMapInfo, getVersions} from "../db/adapters/MapAdapter";
import {TokenBucket} from "../util/TokenBucket";
import {prettifyId, unprettifyId} from "../util/IdPrettifier";
import {mustGetUser} from "../auth/UserManager";

const mapPool = new TokenBucket(10, 1);

route("GET", "/maps/:id").handle(async req => {
	const id = unprettifyId(req.params.id);
	if (id === undefined) {
		return new Response("Bad Request", {status: 400});
	}

	const entry = await getMapEntry(id).catch(() => undefined);
	if (!entry) {
		return new Response("Not Found", {status: 404});
	}
	return Response.json({
		id: prettifyId(entry.id),
		name: entry.name,
		description: entry.description,
		author: await mustGetUser(entry.user_id),
		versions: (await getVersions(id, 0)).map(v => (v.id as unknown) = prettifyId(v.id))
	});
}, mapPool);

route("GET", "/maps/:id/versions", true).handle(async (searchParams, req) => {
	const id = unprettifyId(req.params.id);
	const page = parseInt(searchParams.get("page") || "0");
	if (id === undefined || isNaN(page) || page < 0) {
		return new Response("Bad Request", {status: 400});
	}

	const versions = await getVersions(id, 5 * page);
	if (!versions) {
		return new Response("Not Found", {status: 404});
	}
	return Response.json(versions.map(v => (v.id as unknown) = prettifyId(v.id)));
}, mapPool);

route("GET", "/maps/versions/:id").auth(false, "service").handle(async (_, req) => {
	const id = unprettifyId(req.params.id);
	if (id === undefined) {
		return new Response("Bad Request", {status: 400});
	}

	return await getMapData(id).then(map => {
		if (!map) {
			return new Response("Not Found", {status: 404});
		}
		return new Response(map);
	}).catch(() => {
		return new Response("Failed to decode requested map", {status: 500});
	})
}, mapPool, 5);

route("GET", "/maps/versions/:id/details").handle(async req => {
	const id = unprettifyId(req.params.id);
	if (id === undefined) {
		return new Response("Bad Request", {status: 400});
	}

	const info = await getMapInfo(id).catch(() => undefined);
	if (!info) {
		return new Response("Not Found", {status: 404});
	}

	const entry = await getMapEntry(info.id).catch(() => undefined);
	if (!entry) {
		return new Response("Failed to load map information", {status: 500});
	}

	return Response.json({
		id: prettifyId(info.id),
		version: info.version,
		time: info.time,
		entry: {
			id: prettifyId(entry.id),
			name: entry.name,
			description: entry.description,
			author: await mustGetUser(entry.user_id)
		}
	});
}, mapPool);