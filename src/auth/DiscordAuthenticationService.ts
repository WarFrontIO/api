import {AuthenticationService} from "./AuthenticationService";
import {AuthenticationException} from "../util/exception/AuthenticationException";
import {hostURL} from "../util/Conf";
import {ServiceUser} from "./AuthenticationManager";
import {getToken, storeToken} from "../db/adapters/AuthenticationAdapter";

export class DiscordAuthenticationService implements AuthenticationService {
	private readonly clientId: string;
	private readonly clientSecret: string;
	private readonly activeTokens: Map<string, { access_token: string, expiresAt: number }> = new Map();

	constructor(clientId: string, clientSecret: string) {
		this.clientId = clientId;
		this.clientSecret = clientSecret;
	}

	/**
	 * Build a Discord authentication service.
	 * Requires the following environment variables:
	 * - DISCORD_CLIENT_ID: the application client ID
	 * - DISCORD_CLIENT_SECRET: the application client secret
	 */
	static build(): DiscordAuthenticationService | null {
		const clientId = process.env.DISCORD_CLIENT_ID;
		const clientSecret = process.env.DISCORD_CLIENT_SECRET;

		if (!clientId || !clientSecret) {
			return null;
		}

		return new DiscordAuthenticationService(clientId, clientSecret);
	}

	getLoginRedirect(state: string): string {
		return `https://discord.com/api/oauth2/authorize?client_id=${this.clientId}&redirect_uri=${encodeURIComponent(`${hostURL}/auth/discord`)}&response_type=code&scope=identify&state=${state}`;
	}

	getState(url: URLSearchParams): string {
		return url.get("state") || "";
	}

	async handleResponse(url: URLSearchParams): Promise<number> {
		const code = url.get("code");
		if (!code) {
			throw new AuthenticationException("Missing code in response");
		}

		const discordResponse: Response | undefined = await fetch("https://discord.com/api/oauth2/token", {
			method: "POST",
			headers: {"Content-Type": "application/x-www-form-urlencoded"},
			body: new URLSearchParams({
				grant_type: "authorization_code",
				code,
				redirect_uri: `${hostURL}/auth/discord`,
				client_id: this.clientId,
				client_secret: this.clientSecret
			}).toString()
		}).catch(() => undefined);
		if (!discordResponse || !discordResponse.ok) {
			throw new AuthenticationException("Failed to get token");
		}

		const discordJson: { access_token: string, expires_in: number, refresh_token: string } | undefined = await discordResponse.json().catch(() => undefined);
		if (!discordJson || !discordJson.access_token || !discordJson.expires_in || !discordJson.refresh_token) {
			throw new AuthenticationException("Failed to parse token");
		}

		const user = await this.fetchUser(discordJson.access_token).catch(() => undefined);
		if (!user) {
			throw new AuthenticationException("Failed to get user information");
		}

		this.activeTokens.set(user.user_id, {access_token: discordJson.access_token, expiresAt: Date.now() + (discordJson.expires_in - 60) * 1000});
		const userId = await storeToken("discord", user.user_id, discordJson.refresh_token).catch(() => undefined);
		if (!userId) {
			throw new AuthenticationException("Failed to store token");
		}

		return userId;
	}

	async getUser(id: string): Promise<ServiceUser> {
		const activeToken = this.activeTokens.get(id);
		let token;
		if (activeToken && activeToken.expiresAt > Date.now()) {
			token = activeToken.access_token;
		} else {
			token = await this.refreshToken(id).catch((e: AuthenticationException) => {throw e});
		}

		return this.fetchUser(token).catch(() => {throw new AuthenticationException("Failed to get user information")});
	}

	/**
	 * Fetch the user information from Discord.
	 * @param token access token
	 * @private
	 */
	private async fetchUser(token: string): Promise<ServiceUser> {
		return new Promise(async (resolve, reject) => {
			const discordResponse = await fetch("https://discord.com/api/users/@me", {
				headers: {Authorization: `Bearer ${token}`}
			}).catch(() => undefined);
			if (!discordResponse || !discordResponse.ok) {
				reject();
				return;
			}
			const discordJson: { id: string, username: string, avatar: string } | undefined = await discordResponse.json().catch(() => undefined);
			if (!discordJson || !discordJson.id || !discordJson.username || !discordJson.avatar) {
				reject();
				return;
			}
			resolve({user_id: discordJson.id, username: discordJson.username, avatar_url: this.getAvatarUrl(discordJson.id, discordJson.avatar)});
		});
	}

	/**
	 * Refresh the access token.
	 * @param id user ID
	 * @private
	 */
	private async refreshToken(id: string): Promise<string> {
		const refreshToken = await getToken("discord", id).catch(() => undefined);
		if (!refreshToken) {
			throw new AuthenticationException("Failed to get refresh token");
		}

		const discordResponse = await fetch("https://discord.com/api/oauth2/token", {
			method: "POST",
			headers: {"Content-Type": "application/x-www-form-urlencoded"},
			body: new URLSearchParams({
				grant_type: "refresh_token",
				refresh_token: refreshToken,
				client_id: this.clientId,
				client_secret: this.clientSecret
			}).toString()
		}).catch(() => undefined);
		if (!discordResponse || !discordResponse.ok) {
			throw new AuthenticationException("Failed to refresh token");
		}

		const discordJson: { access_token: string, expires_in: number, refresh_token: string } | undefined = await discordResponse.json().catch(() => undefined);
		if (!discordJson || !discordJson.access_token || !discordJson.expires_in || !discordJson.refresh_token) {
			throw new AuthenticationException("Failed to parse token");
		}

		this.activeTokens.set(id, {access_token: discordJson.access_token, expiresAt: Date.now() + (discordJson.expires_in - 60) * 1000});
		await storeToken("discord", id, discordJson.refresh_token).catch(() => {
			throw new AuthenticationException("Failed to store token");
		});

		return discordJson.access_token;
	}

	/**
	 * Get the avatar URL for a user, using the default avatar if none is provided.
	 * @param id user ID
	 * @param avatar user avatar
	 * @private
	 */
	private getAvatarUrl(id: string, avatar: string): string {
		if (avatar) {
			return `https://cdn.discordapp.com/avatars/${id}/${avatar}.png`;
		}
		const index = Math.floor(parseInt(id) / Math.pow(2, 22)) % 6;
		return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
	}
}