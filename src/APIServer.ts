import {createServer, IncomingMessage, ServerResponse} from "http";
import {hostURL, port} from "./util/Conf";

const getRoutes: Map<string, Function> = new Map();
const postRoutes: Map<string, Function> = new Map();

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
		getRoutes.get(path)!(req, res, url);
	} else if (req.method === "POST" && postRoutes.has(path)) {
		if (!req.headers["content-type"] || !req.headers["content-type"].startsWith("application/x-www-form-urlencoded")) {
			res.writeHead(400);
			res.end();
			return;
		}

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
				url = new URL(hostURL + req.url + "?" + body);
			} catch (e) {
				res.writeHead(400);
				res.end();
				return;
			}
			postRoutes.get(path)!(req, res, url);
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
 */
export function registerRoute(path: string, callback: (req: IncomingMessage, res: ServerResponse, url: URL) => void) {
	getRoutes.set(path, callback);
}

/**
 * Register a POST route.
 * Incoming x-www-form-urlencoded data will be parsed into the URL.
 * @param path the path
 * @param callback the callback, takes the request, response, and URL
 */
export function registerPostRoute(path: string, callback: (req: IncomingMessage, res: ServerResponse, url: URL,) => void) {
	postRoutes.set(path, callback);
}

require("./auth/AuthenticationManager");

server.listen(port);
console.log(`Server running on port ${port}`);