import {existsSync, readFileSync, writeFileSync} from "node:fs";
import {generateKeyPairSync} from "node:crypto";
import {sign, verify} from "jsonwebtoken";
import type {User, auth, APIUser} from "./AuthenticationManager";
import {unprettifyId} from "../util/IdPrettifier";

if (!existsSync("private.key") || !existsSync("public.key")) {
	console.info("No key pair found, generating new one...");
	const pair = generateKeyPairSync("rsa", {
		modulusLength: 4096,
		publicKeyEncoding: {type: "spki", format: "pem"},
		privateKeyEncoding: {type: "pkcs8", format: "pem"}
	});
	writeFileSync("private.key", pair.privateKey);
	writeFileSync("public.key", pair.publicKey);
}
const privateKey = readFileSync("private.key");
const publicKey = readFileSync("public.key");

/**
 * Generate a token
 * @param user the user to generate the token for
 * @returns the token and its expiration time
 */
export async function generateToken(user: APIUser): Promise<{ token: string, expiresIn: number }> {
	return new Promise((resolve, reject) => {
		sign({type: "user", ...user}, privateKey, {algorithm: "RS256", expiresIn: 60 * 15}, (err, token) => {
			if (err || !token) {
				reject(err);
				return;
			}
			resolve({token, expiresIn: 60 * 15});
		});
	});
}

/**
 * Generate an external token, used to authenticate with third-party services
 * This token is only valid for the specified host
 * @param user the user to generate the token for
 * @param host the server to generate the token for
 */
export async function generateExternalToken(user: APIUser, host: string): Promise<string> {
	return new Promise((resolve, reject) => {
		sign({type: "external", ...user}, privateKey, {algorithm: "RS256", expiresIn: 60, audience: host}, (err, token) => {
			if (err || !token) {
				reject(err);
				return;
			}
			resolve(token);
		});
	});
}

/**
 * Verify a token, only accepts user tokens
 * @param token the token to verify
 * @returns the user information
 * @internal Consider using the wrapper {@link auth} instead
 */
export async function verifyToken(token: string): Promise<User> {
	return new Promise((resolve, reject) => {
		verify(token, publicKey, {algorithms: ["RS256"]}, (err, decoded) => {
			if (err || !decoded || typeof decoded !== "object") {
				reject();
				return;
			}
			if (typeof decoded.type !== "string" || decoded.type !== "user" || typeof decoded.id !== "string" || typeof decoded.service !== "string" || typeof decoded.user_id !== "string" || typeof decoded.username !== "string" || typeof decoded.avatar_url !== "string") {
				reject();
				return;
			}
			const id = unprettifyId(decoded.id);
			if (!id) {
				reject();
				return;
			}
			resolve({id: id, service: decoded.service, user_id: decoded.user_id, username: decoded.username, avatar_url: decoded.avatar_url});
		});
	});
}