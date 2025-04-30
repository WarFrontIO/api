import {randomBytes} from "node:crypto";
import {type IncomingMessage} from "http";

/**
 * Port to run the server on
 */
export const port = parseInt(process.env.PORT ?? "13527");
/**
 * Host URL
 */
export const hostURL = process.env.HOST_URL ? (process.env.HOST_URL.startsWith("http") ? process.env.HOST_URL : "https://" + process.env.HOST_URL).replace(/\/$/, "") : undefined;
/**
 * Client URL
 */
export const clientUrl = process.env.CLIENT_URL ? process.env.CLIENT_URL.replace(/\/$/, "") : "https://warfront.io";
/**
 * Allowed authentication hosts
 */
export const allowedHosts = process.env.ALLOWED_HOSTS ? process.env.ALLOWED_HOSTS.split(",") : ["http://localhost:8080/auth"]
/**
 * Private internal service token
 */
export const serviceToken = process.env.SERVICE_TOKEN ? Buffer.from(process.env.SERVICE_TOKEN, "base64") : randomBytes(32);
/**
 * Whether to use the X-Forwarded-For header as the IP address
 */
export const getIP = process.env.USE_X_FORWARDED_FOR ? (req: IncomingMessage) => req.headers["x-forwarded-for"]?.toString() : (req: IncomingMessage) => req.socket.remoteAddress;
/**
 * MySQL database host
 */
export const dbHost = process.env.DB_HOST ?? "localhost";
/**
 * MySQL database port
 */
export const dbPort = parseInt(process.env.DB_PORT ?? "3306");
/**
 * MySQL database name
 */
export const dbName = process.env.DB_NAME;
/**
 * MySQL database user
 */
export const dbUser = process.env.DB_USER;
/**
 * MySQL database password
 */
export const dbPassword = process.env.DB_PASS;

if (!hostURL) {
	console.error("Server URL not provided");
	console.error("Please provide a public URL for the server using the HOST_URL environment variable");
	process.exit(1);
}

if (!process.env.SERVICE_TOKEN) {
	console.warn("Service token not provided, using a random token");
}

if (!dbName || !dbUser || dbPassword === undefined) {
	console.error("Database credentials not provided");
	console.error("Please provide the database credentials using the DB_NAME, DB_USER, and DB_PASS environment variables");
	process.exit(1);
}