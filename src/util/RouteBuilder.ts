import type {BunRequest, Server} from "bun";
import type {TokenBucket} from "./TokenBucket.ts";
import type {auth as authAlt, authService as authServiceAlt, User} from "../auth/AuthenticationManager.ts";
import {rateLimit, registerRoute} from "../APIServer.ts";

/**
 * Create a new Route.
 * Note that without calling {@link Route.handle} this does not have any effect.
 * @param method The method allowed by the route
 * @param path The path of the route
 * @param params Whether the route should accept params (in query / body depending on method)
 */
export function route<T extends string, P extends string>(method: T, path: P, params?: false): Route<T, P, "none", false, false>
export function route<T extends string, P extends string>(method: T, path: P, params: true): Route<T, P, "none", false, true>
export function route(method: string, path: string, params: boolean = false) {
	return new Route(method, path, "none", false, params);
}

class Route<M extends string, P extends string, A extends "user" | "service" | "none", R extends boolean, S extends boolean> {
	constructor(
		private readonly method: M,
		private readonly path: P,
		private authType: A,
		private authRequired: R,
		private parseParams: S
	) {}

	/**
	 * Add user authentication to route.
	 * @param required Whether the authentication is required (defaults to true)
	 * @param type Type of authentication, "user" or "service"
	 */
	auth(required?: true, type?: "user"): Route<M, P, "user", true, S>;
	auth(required: false, type?: "user"): Route<M, P, "user", false, S>;
	auth(required: true, type: "service"): Route<M, P, "service", true, S>;
	auth(required: false, type: "service"): Route<M, P, "service", false, S>;
	auth(required: boolean = true, type: "user" | "service" = "user") {
		const route = this as Route<M, P, "user" | "service", boolean, S>;
		route.authType = type;
		route.authRequired = required;
		return route;
	}

	handle(callback: (...params: BuildArgs<P, A, R, S>) => Response | Promise<Response>, rateLimit: RateLimitType<A, R>, tokenCount: number = 1) {
		registerRoute(this.path, this.method, this.getRouteCallback(callback as (...params: unknown[]) => Response | Promise<Response>, rateLimit as TokenBucket, tokenCount));
	}

	private getRouteCallback(callback: (...params: unknown[]) => Response | Promise<Response>, bucket: TokenBucket, tokenCount: number): (req: BunRequest<P>, res: Server) => Response | Promise<Response> {
		if (this.parseParams) {
			const getParams = this.getPatternParser();
			if (this.authType === "none") {
				return async req => {
					const params = await getParams(req);
					if (params === undefined) return new Response("Bad Request", {status: 400});
					return rateLimit(req, bucket, tokenCount) ?? callback(params, req);
				};
			}
			if (this.authType === "user") {
				const authFunc = (auth<P>).bind(undefined, this.authRequired);
				return async (req, sev) => {
					const params = await getParams(req);
					if (params === undefined) return new Response("Bad Request", {status: 400});
					const auth = await authFunc(req, sev);
					if (!auth.success) return auth.error;
					return rateLimit(req, bucket, tokenCount) ?? callback(params, auth.user, req);
				};
			}
			const authFunc = (authService<P>).bind(undefined, this.authRequired);
			if (this.authRequired) { //Required server auth, this does not need rate limiting
				return async (req, sev) => {
					const params = await getParams(req);
					if (params === undefined) return new Response("Bad Request", {status: 400});
					const auth = await authFunc(req, sev);
					return auth.success ? callback(params, req) : auth.error;
				};
			}
			return async (req, sev) => {
				const params = await getParams(req);
				if (params === undefined) return new Response("Bad Request", {status: 400});
				const auth = await authFunc(req, sev);
				if (!auth.success) return auth.error;
				return auth.user ? callback(params, true, req) : rateLimit(req, bucket, tokenCount) ?? callback(params, false, req);
			};
		}
		if (this.authType === "none") {
			return req => rateLimit(req, bucket, tokenCount) ?? callback(req);
		}
		if (this.authType === "user") {
			const authFunc = (auth<P>).bind(undefined, this.authRequired);
			return async (req, sev) => {
				const auth = await authFunc(req, sev);
				if (!auth.success) return auth.error;
				return rateLimit(req, bucket, tokenCount) ?? callback(auth.user, req);
			};
		}
		const authFunc = (authService<P>).bind(undefined, this.authRequired);
		if (this.authRequired) { //Required server auth, this does not need rate limiting
			return async (req, sev) => {
				const auth = await authFunc(req, sev);
				return auth.success ? callback(req) : auth.error;
			};
		}
		return async (req, sev) => {
			const auth = await authFunc(req, sev);
			if (!auth.success) return auth.error;
			return auth.user ? callback(true, req) : rateLimit(req, bucket, tokenCount) ?? callback(false, req);
		};
	}

	private getPatternParser(): (req: BunRequest<P>) => Promise<URLSearchParams | undefined> {
		if (this.method === "GET") {
			return async req => new URL(req.url).searchParams;
		}
		return async req => {
			if (!req.headers.get("content-type")?.startsWith("application/x-www-form-urlencoded")) {
				return undefined;
			}
			try {
				return new URL(req.url + "?" + await req.text()).searchParams;
			} catch (e) {
				return undefined;
			}
		};
	}
}

let auth: authAlt;
let authService : typeof authServiceAlt;

export function initAuthHandlers(authAlt: typeof auth, authServiceAlt: typeof authService) {
	auth = authAlt;
	authService = authServiceAlt;
}

type BuildArgs<P extends string, A extends "user" | "service" | "none", R extends boolean, S extends boolean> = S extends true ? [URLSearchParams, ...BuildAuth<A, R>, BunRequest<P>] : [...BuildAuth<A, R>, BunRequest<P>];
type BuildAuth<A extends "user" | "service" | "none", R extends boolean> = A extends "user" ? [User | (R extends true ? never : null)] : A extends "service" ? R extends true ? [] : [boolean] : [];
type RateLimitType<A extends "user" | "service" | "none", R extends boolean> = A extends "service" ? R extends true ? void : TokenBucket : TokenBucket;