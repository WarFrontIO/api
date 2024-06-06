import {AuthenticationService} from "./AuthenticationService";
import {DiscordAuthenticationService} from "./DiscordAuthenticationService";
import {registerPostRoute, registerRoute} from "../APIServer";
import {IncomingMessage, ServerResponse} from "http";
import {randomBytes, timingSafeEqual} from "node:crypto";
import {clientUrl, serviceToken} from "../util/Conf";
import {AuthenticationException} from "../util/exception/AuthenticationException";
import {housekeeping} from "../util/Housekeeping";
import {generateToken, verifyToken} from "./TokenManager";
import {logout, refreshDevice, registerDevice, revokeDevice} from "../db/adapters/AuthenticationAdapter";
import {prettifyId} from "../util/IdPrettifier";

class AuthenticationManager {
	private readonly services: Map<string, AuthenticationService> = new Map();
	private readonly activeStates: Map<string, number> = new Map();
	private readonly authTokens: Map<string, { id: number, expiresAt: number }> = new Map();

	/**
	 * Register an authentication service.
	 * @param name the name of the service
	 * @param service the service to register
	 */
	registerService(name: string, service: AuthenticationService | null) {
		if (!service) {
			console.warn(`${name} authentication not configured`);
			return;
		}
		this.services.set(name, service);

		registerRoute(`/login/${name}`, (req, res, url) => this.handleLogin(req, res, url, service));
		registerRoute(`/auth/${name}`, (req, res, url) => this.handleResponse(req, res, url, service));
	}

	/**
	 * Handle login request, this will redirect the user to the login provider.
	 * @param _req the request
	 * @param res the response
	 * @param _url the URL
	 * @param service the authentication service
	 */
	handleLogin(_req: IncomingMessage, res: ServerResponse, _url: URL, service: AuthenticationService) {
		const state = randomBytes(20).toString("hex");
		this.activeStates.set(state, Date.now() + 15 * 60 * 1000); // 15 minutes
		res.writeHead(302, {Location: service.getLoginRedirect(state)});
		res.end();
	}

	/**
	 * Handle response from the login provider.
	 * @param _req the request
	 * @param res the response
	 * @param url the URL, contains information from the login provider such as the state
	 * @param service the authentication service
	 */
	handleResponse(_req: IncomingMessage, res: ServerResponse, url: URL, service: AuthenticationService) {
		const state = service.getState(url.searchParams);
		if (!state || !this.activeStates.has(state)) {
			res.writeHead(400);
			res.end();
			return;
		}

		const expiration = this.activeStates.get(state);
		if (!expiration || expiration < Date.now()) {
			res.writeHead(400);
			res.end();
			return;
		}
		this.activeStates.delete(state);

		service.handleResponse(url.searchParams).then((id) => {
			const authToken = randomBytes(20).toString("hex");
			this.authTokens.set(authToken, {id, expiresAt: Date.now() + 10 * 1000}); // 10 seconds (client callback should be immediate)
			res.writeHead(302, {Location: `${clientUrl}/auth/?token=${authToken}`});
			res.end();
		}).catch((e: AuthenticationException) => {
			res.writeHead(400, {"Content-Type": "text/plain"});
			res.write(e.message);
			res.end();
		});
	}

	/**
	 * Handle initial token request, this will be requested by the client after logging in.
	 * @param _req the request
	 * @param res the response
	 * @param url the URL
	 */
	async handleInitialToken(_req: IncomingMessage, res: ServerResponse, url: URL) {
		const token = url.searchParams.get("token") || "";
		const device = url.searchParams.get("device") || "";
		if (!token || !device || !this.authTokens.has(token)) {
			res.writeHead(400);
			res.end();
			return;
		}

		const authToken = this.authTokens.get(token);
		if (!authToken || authToken.expiresAt < Date.now()) {
			res.writeHead(400, {"Content-Type": "text/plain"});
			res.write("Token expired, please try again");
			res.end();
			return;
		}
		this.authTokens.delete(token);

		const refreshToken = await registerDevice(authToken.id, device).catch(() => null);
		if (!refreshToken) {
			res.writeHead(500, {"Content-Type": "text/plain"});
			res.write("Failed to generate refresh token");
			res.end();
			return;
		}

		res.writeHead(200, {"Content-Type": "text/plain"});
		res.write(refreshToken);
		res.end();
	}

	/**
	 * Handle token refresh request, this will be requested by the client when they refresh the page or when the token expires.
	 * @param _req the request
	 * @param res the response
	 * @param url the URL
	 */
	async handleRefreshToken(_req: IncomingMessage, res: ServerResponse, url: URL) {
		const token = url.searchParams.get("token") || "";
		const device = url.searchParams.get("device") || "";
		if (!token || !device) {
			res.writeHead(400);
			res.end();
			return;
		}

		const tokenData = await refreshDevice(token, device).catch(() => null);
		if (!tokenData) {
			res.writeHead(401, {"Content-Type": "text/plain"});
			res.write("Invalid token");
			res.end();
			return;
		}

		const handler = this.services.get(tokenData.service);
		if (!handler) {
			res.writeHead(500, {"Content-Type": "text/plain"});
			res.write("Invalid handler");
			res.end();
			return;
		}

		const user = await handler.getUser(tokenData.user_id).then(user => toAPIUser(user, tokenData.id, tokenData.service)).catch(() => null);
		if (!user) {
			res.writeHead(500, {"Content-Type": "text/plain"});
			res.write("Failed to get user information");
			res.end();
			return;
		}

		const accessToken = await generateToken(user).catch(() => null);
		if (!accessToken) {
			res.writeHead(500, {"Content-Type": "text/plain"});
			res.write("Failed to generate access token");
			res.end();
			return;
		}

		res.writeHead(200, {"Content-Type": "application/json"});
		res.write(JSON.stringify({access_token: accessToken.token, expires_in: accessToken.expiresIn - 60, refresh_token: tokenData.token, user}));
		res.end();
	}

	/**
	 * Handle logout request, revokes the specified refresh token.
	 * @param _req the request
	 * @param res the response
	 * @param url the URL
	 */
	revoke(_req: IncomingMessage, res: ServerResponse, url: URL) {
		const token = url.searchParams.get("token") || "";
		if (!token) {
			res.writeHead(400);
			res.end();
			return;
		}
		revokeDevice(token).catch(() => {});
		res.writeHead(200);
		res.end();
	}

	/**
	 * Handle logout request, revokes all refresh tokens for the specified user.
	 * @param req the request
	 * @param res the response
	 * @param _url the URL
	 */
	logout(req: IncomingMessage, res: ServerResponse, _url: URL) {
		auth(req, res).then((user) => {
			logout(user.id).catch(() => {});
			res.writeHead(200);
			res.end();
		}).catch(() => {});
	}

	/**
	 * Verify a request.
	 * @param req the request
	 * @param res the response
	 */
	async verifyRequest(req: IncomingMessage, res: ServerResponse): Promise<User> {
		const token = req.headers.authorization;
		if (!token || !token.startsWith("Bearer ")) {
			res.writeHead(401, {"Content-Type": "text/plain"});
			res.write("Unauthorized");
			res.end();
			throw new AuthenticationException("Invalid token");
		}

		const user = await verifyToken(token.substring(7)).catch(() => null);
		if (!user) {
			res.writeHead(401, {"Content-Type": "text/plain"});
			res.write("Unauthorized");
			res.end();
			throw new AuthenticationException("Invalid token");
		}

		return user;
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
			if (value < Date.now()) {
				this.activeStates.delete(key);
			}
		});
	}
}

const manager = new AuthenticationManager();

manager.registerService("discord", DiscordAuthenticationService.build());

registerPostRoute("/auth", manager.handleInitialToken.bind(manager));
registerPostRoute("/token", manager.handleRefreshToken.bind(manager));
registerPostRoute("/revoke", manager.revoke.bind(manager));
registerPostRoute("/logout", manager.logout.bind(manager));

housekeeping.registerMinorTask(manager.cleanUpTokens.bind(manager));

/**
 * Get the user information from the request.
 * Use this method for all API routes that require authentication.
 * @param req the request
 * @param res the response
 */
export const auth = manager.verifyRequest.bind(manager);

/**
 * Service authentication.
 * Use this method for all internal service endpoints e.g. game server results.
 * @param req the request
 * @param res the response
 */
export async function authService(req: IncomingMessage, res: ServerResponse) {
	if (!req.headers.authorization || !req.headers.authorization.startsWith("Bearer ") || req.headers.authorization.length - 7 !== serviceToken.length) {
		res.writeHead(401, {"Content-Type": "text/plain"});
		res.write("Unauthorized");
		res.end();
		throw new AuthenticationException("Invalid token");
	}

	if (!timingSafeEqual(Buffer.from(req.headers.authorization.substring(7)), serviceToken)) {
		res.writeHead(401, {"Content-Type": "text/plain"});
		res.write("Unauthorized");
		res.end();
		throw new AuthenticationException("Invalid token");
	}

	res.writeHead(200);
	res.end();
	return;
}

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

export function toAPIUser(user: ServiceUser, id: number, service: string): APIUser {
	return {...user, id: prettifyId(id), service};
}