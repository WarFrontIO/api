import {housekeeping} from "./Housekeeping";

export class TokenBucket {
	private readonly capacity: number;
	private readonly tokens: Map<string, number>;
	private readonly refillRate: number;

	/**
	 * Create a new token bucket
	 * @param capacity The maximum number of tokens
	 * @param refillRate The number of tokens to add per second
	 */
	constructor(capacity: number, refillRate: number) {
		this.capacity = capacity;
		this.tokens = new Map();
		this.refillRate = refillRate / 1000;
		housekeeping.registerMinorTask(() => this.cleanup());
	}

	/**
	 * Consume tokens from the bucket
	 * @param key The key to consume tokens for
	 * @param tokens The number of tokens to consume, should be smaller than the capacity
	 * @returns true if the tokens were consumed, false if there were not enough tokens
	 */
	consume(key: string, tokens: number): boolean {
		const tokensUsed = this.tokens.get(key) || 0;
		const totalTokens = Date.now() * this.refillRate;
		if (tokensUsed + tokens > totalTokens) return false;
		this.tokens.set(key, Math.max(tokensUsed + tokens, totalTokens - this.capacity + tokens));
		return true;
	}

	/**
	 * Test whether tokens could be consumed from the bucket
	 * @param key The key to consume tokens for
	 * @param tokens The number of tokens to consume, should be smaller than the capacity
	 * @returns true if the tokens can be consumed, false if there are not enough tokens
	 */
	canConsume(key: string, tokens: number): boolean {
		const tokensUsed = this.tokens.get(key) || 0;
		const totalTokens = Date.now() * this.refillRate;
		return tokensUsed + tokens <= totalTokens;
	}

	/**
	 * Remove all keys that have not been used in a while (reached maximum capacity again)
	 * @private
	 */
	private cleanup() {
		const maxTokens = Date.now() * this.refillRate - this.capacity;
		for (const [key, tokens] of this.tokens) {
			if (tokens < maxTokens) this.tokens.delete(key);
		}
	}

	/**
	 * Get the time until the bucket refills
	 * @param key The key to check
	 * @param tokens The number of tokens to add
	 * @returns The time in milliseconds until the bucket refills
	 */
	timeUntilRefill(key: string, tokens: number) {
		return Math.max(0, ((this.tokens.get(key) || 0) + tokens) / this.refillRate - Date.now());
	}
}