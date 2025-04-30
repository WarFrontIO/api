import {createServer, IncomingMessage, ServerResponse} from "http";
import {getIP, hostURL, port} from "./util/Conf";
import {TokenBucket} from "./util/TokenBucket";

const getRoutes: Map<string, APIRoute> = new Map();
const postRoutes: Map<string, APIRoute> = new Map();

const server = createServer((req, res) => {
	if (!req.url) {
		res.writeHead(400);
		res.end();
		return;
	}

	let url = new URL(req.url, hostURL);
	let path: string = url.pathname.toLowerCase();

	if (path.endsWith("/")) {
		path = path.substring(0, path.length - 1);
	}

	if (req.method === "GET" && getRoutes.has(path)) {
		const route = getRoutes.get(path)!;
		if (!rateLimit(req, res, route)) return;
		route.function(req, res, url);
	} else if (req.method === "POST" && postRoutes.has(path)) {
		if (!req.headers["content-type"] || !req.headers["content-type"].startsWith("application/x-www-form-urlencoded")) {
			res.writeHead(400);
			res.end();
			return;
		}

		const route = postRoutes.get(path)!;
		if (!rateLimit(req, res, route)) return;

		req.setEncoding("binary");
		let body = "";
		req.on("data", (chunk) => {
			body += chunk;
			if (body.length > 1e6) {
				body = "";
				res.writeHead(413);
				res.end();
				req.socket.destroy();
			}
		});
		req.on("end", () => {
			try {
				url = new URL(req.url + "?" + body, hostURL);
			} catch (e) {
				res.writeHead(400);
				res.end();
				return;
			}
			route.function(req, res, url);
		});
	} else {
		res.writeHead(404);
		res.end();
	}
});

/**
 * Register a GET route.
 * @param path the path
 * @param callback the callback, takes the request, response, and URL
 * @param rateLimit the rate limit for this route
 * @param tokenCount the number of tokens to consume
 */
export function registerRoute(path: string, callback: (req: IncomingMessage, res: ServerResponse, url: URL) => void, rateLimit: TokenBucket, tokenCount: number = 1) {
	getRoutes.set(path, {function: callback, rateLimit, tokenCount});
}

/**
 * Register a POST route.
 * Incoming x-www-form-urlencoded data will be parsed into the URL.
 * @param path the path
 * @param callback the callback, takes the request, response, and URL
 * @param rateLimit the rate limit for this route
 * @param tokenCount the number of tokens to consume
 */
export function registerPostRoute(path: string, callback: (req: IncomingMessage, res: ServerResponse, url: URL) => void, rateLimit: TokenBucket, tokenCount: number = 1) {
	postRoutes.set(path, {function: callback, rateLimit, tokenCount});
}

type APIRoute = {
	function: Function,
	rateLimit: TokenBucket,
	tokenCount: number
}

function rateLimit(req: IncomingMessage, res: ServerResponse, route: APIRoute) {
	const ip = getIP(req);
	if (!ip) {
		res.writeHead(400);
		res.end();
		return false;
	}
	if (!route.rateLimit.consume(ip, route.tokenCount)) {
		res.writeHead(429, {
			"Retry-After": Math.ceil(route.rateLimit.timeUntilRefill(ip, route.tokenCount) / 1000).toString()
		});
		res.end();
		return false;
	}
	return true;
}

require("./auth/AuthenticationManager");
require("./util/APIDocs");

server.listen(port);
console.log(`Server running on port ${port}`);