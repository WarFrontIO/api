/**
 * Port to run the server on
 */
export const port = parseInt(process.env.PORT ?? "13527");
/**
 * Host URL
 */
export const hostURL = process.env.HOST_URL ? process.env.HOST_URL.endsWith("/") ? process.env.HOST_URL.slice(0, -1) : process.env.HOST_URL : undefined as unknown as string;
/**
 * Client URL
 */
export const clientUrl = process.env.CLIENT_URL ? (process.env.CLIENT_URL as string).endsWith("/") ? (process.env.CLIENT_URL as string).slice(0, -1) : process.env.CLIENT_URL as string : "https://warfront.io";
/**
 * Private internal service token
 */
export const serviceToken = Buffer.from(process.env.SERVICE_TOKEN ?? "", "base64");
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

if (!serviceToken.length) {
	console.error("Service token not provided");
	console.error("Please provide a secure token shared between warfront servers using the SERVICE_TOKEN environment variable");
	process.exit(1);
}

if (!dbName || !dbUser || !dbPassword) {
	console.error("Database credentials not provided");
	console.error("Please provide the database credentials using the DB_NAME, DB_USER, and DB_PASSWORD environment variables");
	process.exit(1);
}