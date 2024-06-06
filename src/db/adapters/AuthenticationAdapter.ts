import {get, insert, run} from "../DataBaseManager";
import {housekeeping} from "../../util/Housekeeping";
import {randomBytes} from "node:crypto";

run("CREATE TABLE IF NOT EXISTS accounts (id INTEGER NOT NULL AUTO_INCREMENT, service VARCHAR(20) NOT NULL, user_id VARCHAR(20) NOT NULL, token TEXT NOT NULL, PRIMARY KEY (service, user_id), KEY (id));", []).catch(() => {});
run("CREATE TABLE IF NOT EXISTS account_tokens (id INTEGER NOT NULL, device_id VARCHAR(32) NOT NULL, token VARCHAR(64) NOT NULL, expires_at INTEGER NOT NULL, PRIMARY KEY (id, device_id), KEY (id));", []).catch(() => {});

function cleanTokens() {
	run("DELETE FROM account_tokens WHERE expires_at < UNIX_TIMESTAMP();", []).catch(() => {});
}

housekeeping.registerMajorTask(cleanTokens);

/**
 * Store a service token for a user (same as creating an account)
 * @param service The service the token is for
 * @param userId The service user ID
 * @param token The service token
 * @returns wf user ID
 */
export async function storeToken(service: string, userId: string, token: string): Promise<number | undefined> {
	return await insert("INSERT INTO accounts (service, user_id, token) VALUES (?, ?, ?) AS new ON DUPLICATE KEY UPDATE token = new.token, id = LAST_INSERT_ID(id);", [service, userId, token]).catch(() => undefined);
}

/**
 * Get a service token for a user
 * @param service The service the token is for
 * @param userId The user ID
 * @returns The token
 */
export async function getToken(service: string, userId: string): Promise<string> {
	return await get<{ token: string }>("SELECT token FROM accounts WHERE service = ? AND user_id = ?;", [service, userId]).then(row => row.token).catch(() => "");
}

/**
 * Register a device for a user
 * @param id The user ID
 * @param device The device ID
 * @returns Refresh token for the device
 */
export async function registerDevice(id: number, device: string): Promise<string> {
	const token = randomBytes(32).toString("hex");
	await run("INSERT INTO account_tokens (id, device_id, token, expires_at) VALUES (?, ?, ?, UNIX_TIMESTAMP() + 30 * 24 * 60 * 60) AS new ON DUPLICATE KEY UPDATE token = new.token, expires_at = new.expires_at;", [id, device, token]).catch(() => {});
	return token;
}

/**
 * Refresh a device token
 * @param token The token to refresh
 * @param device The device ID
 * @returns The wf ID, service, user ID and new token
 */
export async function refreshDevice(token: string, device: string): Promise<{ id: number, service: string, user_id: string, token: string }> {
	const newToken = randomBytes(32).toString("hex");
	const changed = await run("UPDATE account_tokens SET token = ?, expires_at = UNIX_TIMESTAMP() + 30 * 24 * 60 * 60 WHERE token = ? AND device_id = ? AND expires_at > UNIX_TIMESTAMP();", [newToken, token, device]).catch(() => 0);
	if (!changed) {
		throw new Error("Token not found");
	}
	const user = await get<{ id: number, service: string, user_id: string }>("SELECT id, service, user_id FROM accounts WHERE id = (SELECT id FROM account_tokens WHERE token = ? AND device_id = ?);", [newToken, device]).catch(() => null);
	if (!user) {
		throw new Error("User not found");
	}
	return {...user, token: newToken};
}

/**
 * Revokes a device token
 * @param token The token to revoke
 */
export async function revokeDevice(token: string): Promise<void> {
	await run("DELETE FROM account_tokens WHERE token = ?;", [token]).catch(() => {});
}

/**
 * Log out a user from all devices
 * @param id The user ID
 */
export async function logout(id: number): Promise<void> {
	await run("DELETE FROM account_tokens WHERE id = ?;", [id]).catch(() => {});
}