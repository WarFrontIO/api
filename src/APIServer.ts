import type {BunRequest, Server} from "bun";
import {port} from "./util/Conf";
import {TokenBucket} from "./util/TokenBucket";

const routes: { [key: string]: { [key: string]: (req: BunRequest<any>, sev: Server) => Response | Promise<Response> } } = {};

require("./auth/AuthenticationManager");
require("./routes/MapRegistry");
require("./util/APIDocs");

const server = Bun.serve({
	port,
	routes,
	fetch() {return new Response("Not found", {status: 404})}
});

/**
 * Register a Route.
 * @param path The path
 * @param method The method
 * @param callback The callback, takes the request and bun http server
 * @internal Use {@link route} instead
 */
export function registerRoute<T extends string>(path: T, method: string, callback: (req: BunRequest<T>, sev: Server) => Response | Promise<Response>) {
	if (!routes[path]) routes[path] = {};
	routes[path]![method] = callback;
}

export function rateLimit<P extends string>(req: BunRequest<P>, bucket: TokenBucket, tokenCount: number): Response | undefined {
	const ip = server.requestIP(req)?.address;
	if (!ip) {
		return new Response("Bad Request", {status: 400});
	}
	if (!bucket.consume(ip, tokenCount)) {
		return new Response("Too Many Requests", {status: 429, headers: {"Retry-After": Math.ceil(bucket.timeUntilRefill(ip, tokenCount) / 1000).toString()}});
	}
	return undefined;
}

console.log(`Server running on port ${port}`);