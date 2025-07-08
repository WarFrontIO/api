import {type APIUser, getAPIUser, toAPIUser} from "./AuthenticationManager";
import {housekeeping} from "../util/Housekeeping";
import {getUserInfo} from "../db/adapters/AuthenticationAdapter";

const userCache: Map<number, { user: APIUser, expiresAt: number }> = new Map();

housekeeping.registerMajorTask(() => {
	const now = Date.now();
	userCache.forEach((user, id) => {
		if (user.expiresAt < now) {
			userCache.delete(id);
		}
	});
});

/**
 * Get an api user.
 * @param id The wf user id
 */
export async function getUser(id: number): Promise<APIUser | undefined> {
	const cachedUser = userCache.get(id);
	if (cachedUser && cachedUser.expiresAt > Date.now()) {
		return cachedUser.user;
	}

	const userInfo = await getUserInfo(id).catch(() => undefined);
	if (!userInfo) return undefined;
	const user = await getAPIUser(id, userInfo.service, userInfo.user_id);
	if (!user) return undefined;

	userCache.set(id, {user, expiresAt: Date.now() + 60 * 60 * 1000});
	return user;
}

/**
 * Wrapper around {@link getUser} that returns an invalid user if the requested is not found.
 * @param id The wf user id
 */
export async function mustGetUser(id: number): Promise<APIUser> {
	return await getUser(id) || toAPIUser({id, service: "", user_id: "", username: "Unknown User", avatar_url: ""});
}