import {ServiceUser} from "./AuthenticationManager";

export interface AuthenticationService {
	/**
	 * Get login redirect URL.
	 * @param state state to pass to the redirect URL
	 * @returns the redirect URL
	 */
	getLoginRedirect(state: string): string;

	/**
	 * Get the current state.
	 * @param url the URL to get the state from
	 * @returns the state from the URL
	 */
	getState(url: URLSearchParams): string;

	/**
	 * Handle response from login provider.
	 * @param url the URL to handle
	 * @returns wf user ID
	 * @throws AuthenticationException if the login failed
	 */
	handleResponse(url: URLSearchParams): Promise<number>;

	/**
	 * Get user information.
	 * This information will be cached in the user token.
	 * @param id the user ID
	 * @throws AuthenticationException if the user information could not be fetched
	 */
	getUser(id: string): Promise<ServiceUser>;
}