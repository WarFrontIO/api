import type {AuthenticationService} from "./AuthenticationService";
import type {BunRequest, Server} from "bun";
import {DiscordAuthenticationService} from "./DiscordAuthenticationService";
import {initAuthHandlers, route} from "../util/RouteBuilder.ts";
import {randomBytes, timingSafeEqual} from "node:crypto";
import {allowedHosts, serviceToken} from "../util/Conf";
import {AuthenticationException} from "../util/exception/AuthenticationException";
import {housekeeping} from "../util/Housekeeping";
import {generateExternalToken, generateToken, verifyToken} from "./TokenManager";
import {logout, refreshDevice, registerDevice, revokeDevice} from "../db/adapters/AuthenticationAdapter";
import {prettifyId} from "../util/IdPrettifier";
import {TokenBucket} from "../util/TokenBucket";

class AuthenticationManager {
	private readonly services: Map<string, AuthenticationService> = new Map();
	private readonly activeStates: Map<string, { timeout: number, clientState: string, redirect: string }> = new Map();
	private readonly authTokens: Map<string, { id: number, expiresAt: number }> = new Map();

	/**
	 * Register an authentication service.
	 * @param name The name of the service
	 * @param service The service to register
	 */
	registerService(name: string, service: AuthenticationService | null) {
		if (!service) {
			console.warn(`${name} authentication not configured`);
			return;
		}
		this.services.set(name, service);

		route("GET", `/login/${name}`, true).handle(this.handleLogin.bind(this, service), new TokenBucket(3, .1));
		route("GET", `/auth/${name}`, true).handle(this.handleResponse.bind(this, service), new TokenBucket(3, .1));
	}

	/**
	 * Handle login request.
	 * This will redirect the user to the login provider.
	 * @param service The authentication service
	 * @param searchParams The parameters
	 */
	handleLogin(service: AuthenticationService, searchParams: URLSearchParams): Response {
		const clientState = searchParams.get("state") || "";
		const redirect = searchParams.get("redirect") || "";
		if (clientState.length >= 40 || redirect.length >= 40 || !allowedHosts.includes(redirect)) {
			return new Response("Bad Request", {status: 400});
		}

		const state = randomBytes(20).toString("hex");
		this.activeStates.set(state, {timeout: Date.now() + 15 * 60 * 1000, clientState, redirect}); // 15 minutes
		return Response.redirect(service.getLoginRedirect(state))
	}

	/**
	 * Handle response from the login provider.
	 * @param service The authentication service
	 * @param searchParams The parameters
	 */
	async handleResponse(service: AuthenticationService, searchParams: URLSearchParams): Promise<Response> {
		const state = service.getState(searchParams);
		if (!state || !this.activeStates.has(state)) {
			return new Response("Bad Request", {status: 400});
		}

		const expiration = this.activeStates.get(state);
		if (!expiration || expiration.timeout < Date.now()) {
			return new Response("Bad Request", {status: 400});
		}
		this.activeStates.delete(state);

		return await service.handleResponse(searchParams).then((id) => {
			const authToken = randomBytes(20).toString("hex");
			this.authTokens.set(authToken, {id, expiresAt: Date.now() + 10 * 1000}); // 10 seconds (client callback should be immediate)
			return Response.redirect(`${expiration.redirect}/?token=${authToken}${expiration.clientState ? `&state=${expiration.clientState}` : ""}`);
		}).catch((e: AuthenticationException) => {
			return new Response(e.message, {status: 422});
		});
	}

	/**
	 * Handle the initial token request.
	 * The client will request this after logging in.
	 * @param body The body
	 */
	async handleInitialToken(body: URLSearchParams): Promise<Response> {
		const token = body.get("token");
		if (!token) {
			return new Response("Bad Request", {status: 400});
		}

		if (!this.authTokens.has(token)) {
			return new Response("Invalid token", {status: 401});
		}

		const authToken = this.authTokens.get(token);
		if (!authToken || authToken.expiresAt < Date.now()) {
			return new Response("Token expired, please try again", {status: 401});
		}
		this.authTokens.delete(token);

		const refreshToken = await registerDevice(authToken.id).catch(() => null);
		if (!refreshToken) {
			return new Response("Failed to generate refresh token", {status: 500});
		}

		return new Response(refreshToken);
	}

	/**
	 * Handle token refresh request.
	 * The client will request this when they refresh the page or when the token expires.
	 * @param body The body
	 */
	async handleRefreshToken(body: URLSearchParams): Promise<Response> {
		const token = body.get("token");
		if (!token) {
			return new Response("Bad Request", {status: 400});
		}

		const tokenData = await refreshDevice(token).catch(() => null);
		if (!tokenData) {
			return new Response("Invalid token", {status: 401});
		}

		const handler = this.services.get(tokenData.service);
		if (!handler) {
			return new Response("Invalid handler", {status: 500});
		}

		const user = await handler.getUser(tokenData.user_id).then(user => buildAPIUser(user, tokenData.id, tokenData.service)).catch(() => null);
		if (!user) {
			return new Response("Failed to get user information", {status: 500});
		}

		const accessToken = await generateToken(user).catch(() => null);
		if (!accessToken) {
			return new Response("Failed to generate an access token", {status: 500});
		}

		return Response.json({access_token: accessToken.token, expires_in: accessToken.expiresIn - 60, refresh_token: tokenData.token, user});
	}

	/**
	 * Get the API user information.
	 * @param id The user ID
	 * @param service The service
	 * @param user_id The user ID on the service
	 */
	async getAPIUser(id: number, service: string, user_id: string): Promise<APIUser | undefined> {
		const handler = this.services.get(service);
		if (!handler) {
			throw new Error("Invalid handler");
		}

		return await handler.getUser(user_id).then(user => buildAPIUser(user, id, service)).catch(() => undefined);
	}

	/**
	 * Handle external token request.
	 * This will generate a token to be used with third-party services.
	 * @param body The body
	 * @param user The user this request comes from
	 */
	async handleExternalToken(body: URLSearchParams, user: User): Promise<Response> {
		const host = body.get("host");
		if (!host) {
			return new Response("Bad Request", {status: 400});
		}

		const token = await generateExternalToken(toAPIUser(user), host).catch(() => undefined);
		if (!token) {
			return new Response("Failed to generate external token", {status: 500});
		}
		return new Response(token);
	}

	/**
	 * Handle logout request.
	 * This revokes the specified refresh token.
	 * @param body The body
	 */
	revoke(body: URLSearchParams): Response {
		const token = body.get("token");
		if (!token) {
			return new Response("Bad Request", {status: 400});
		}
		revokeDevice(token).catch(() => {});
		return new Response("OK");
	}

	/**
	 * Handle logout request.
	 * This revokes all refresh tokens for the specified user.
	 * @param user The user this request comes from
	 */
	logout(user: User): Response {
		logout(user.id).catch(() => {});
		return new Response("OK");
	}

	/**
	 * Verify a request.
	 * @param force Whether to return error response if user did not try to sign in
	 * @param req The request
	 * @param sev The bun http server
	 * @throws Error If user could not be authenticated
	 */
	async verifyRequest<P extends string>(this: undefined, force: boolean, req: BunRequest<P>, sev: Server): Promise<{ success: true, user: User | null } | { success: false, error: Response }> {
		const ip = sev.requestIP(req)?.address;
		if (!ip) {
			return {success: false, error: new Response("Bad Request", {status: 400})};
		}
		if (!authPool.canConsume(ip, 1)) {
			return {success: false, error: new Response("Too Many Requests", {status: 429, headers: {"Retry-After": Math.ceil(authPool.timeUntilRefill(ip, 1) / 1000).toString()}})};
		}
		const token = req.headers.get("authorization");
		if (!token || !token.startsWith("Bearer ")) {
			if (force) {
				return {success: false, error: new Response("Unauthorized", {status: 400})};
			}
			return {success: true, user: null}; //No sign in attempt
		}

		const user = await verifyToken(token.substring(7)).catch(() => null);
		if (!user) {
			authPool.consume(ip, 1);
			return {success: false, error: new Response("Unauthorized", {status: 401})};
		}

		return {success: true, user};
	}

	/**
	 * Chore to clean up expired tokens.
	 */
	cleanUpTokens() {
		this.authTokens.forEach((value, key) => {
			if (value.expiresAt < Date.now()) {
				this.authTokens.delete(key);
			}
		});
		this.activeStates.forEach((value, key) => {
			if (value.timeout < Date.now()) {
				this.activeStates.delete(key);
			}
		});
	}
}

const authPool = new TokenBucket(5, .2);
const manager = new AuthenticationManager();

/**
 * Service authentication.
 * Use this method for all internal service endpoints e.g. game server results.
 * @param force Whether to return error response if user did not try to sign in
 * @param req The request
 * @param sev The bun http server
 */
export async function authService<P extends string>(this: undefined, force: boolean, req: BunRequest<P>, sev: Server): Promise<{ success: true, user: boolean } | { success: false, error: Response }> {
	const ip = sev.requestIP(req)?.address;
	if (!ip) {
		return {success: false, error: new Response("Bad Request", {status: 400})};
	}
	if (!authPool.canConsume(ip, 1)) {
		return {success: false, error: new Response("Too Many Requests", {status: 429, headers: {"Retry-After": Math.ceil(authPool.timeUntilRefill(ip, 1) / 1000).toString()}})};
	}
	const token = req.headers.get("authorization");
	if (!token || !token.startsWith("Bearer ") || token.length - 7 !== serviceToken.length) {
		if (force) {
			return {success: false, error: new Response("Unauthorized", {status: 400})};
		}
		return {success: true, user: false}; //No sign in attempt
	}

	if (!timingSafeEqual(Buffer.from(token.substring(7)), serviceToken)) {
		authPool.consume(ip, 5);
		return {success: false, error: new Response("Unauthorized", {status: 401})};
	}

	return {success: true, user: true};
}

initAuthHandlers(manager.verifyRequest, authService)

manager.registerService("discord", DiscordAuthenticationService.build());

route("POST", "/auth", true).handle(manager.handleInitialToken.bind(manager), new TokenBucket(3, .1));
route("POST", "/token", true).handle(manager.handleRefreshToken.bind(manager), authPool);
route("POST", "/token/external", true).auth().handle(manager.handleExternalToken.bind(manager), authPool);
route("POST", "/revoke", true).handle(manager.revoke.bind(manager), authPool);
route("POST", "/logout").auth().handle(manager.logout.bind(manager), authPool);

housekeeping.registerMinorTask(manager.cleanUpTokens.bind(manager));

export const getAPIUser = manager.getAPIUser.bind(manager);

export type User = {
	/** WF user ID */
	id: number,
	service: string,
	/** Service user ID */
	user_id: string,
	username: string,
	avatar_url: string
};
export type APIUser = Omit<User, "id"> & { id: string };
export type ServiceUser = Omit<User, "id" | "service"> & Partial<Pick<User, "id" | "service">>;
export type auth = typeof manager.verifyRequest;

export function buildAPIUser(user: ServiceUser, id: number, service: string): APIUser {
	return {...user, id: prettifyId(id), service};
}

export function toAPIUser(user: User): APIUser {
	return {...user, id: prettifyId(user.id)};
}