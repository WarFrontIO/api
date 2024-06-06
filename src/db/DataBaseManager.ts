import {createPool, ResultSetHeader, RowDataPacket} from "mysql2/promise";
import {dbHost, dbName, dbPassword, dbPort, dbUser} from "../util/Conf";

const db = createPool({
	host: dbHost,
	port: dbPort,
	user: dbUser,
	password: dbPassword,
	database: dbName
});

/**
 * Run a query on the database
 * @param query The query to run
 * @param params The parameters to use in the query
 * @returns The number of rows affected
 * @throws Error if the query fails
 */
export async function run(query: string, params: (string | number)[]): Promise<number> {
	const [result] = await db.execute<ResultSetHeader>(query, params).catch(err => {
		console.error(err);
		throw err;
	});
	if (!result || !result.affectedRows) {
		throw new Error("Query failed");
	}
	return result.affectedRows;
}

/**
 * Insert a row into the database
 * @param query The query to run
 * @param params The parameters to use in the query
 * @returns The ID of the inserted row
 * @throws Error if the query fails
 */
export async function insert(query: string, params: (string | number)[]): Promise<number> {
	const [result] = await db.execute<ResultSetHeader>(query, params).catch(err => {
		console.error(err);
		throw err;
	});
	if (!result || !result.insertId) {
		throw new Error("No ID returned");
	}
	return result.insertId;
}

/**
 * Run a query on the database and return the result
 * @param query The query to run
 * @param params The parameters to use in the query
 * @returns The result of the query
 * @throws Error if the query fails
 */
export async function get<T>(query: string, params: (string | number)[]): Promise<T> {
	const [rows] = await db.execute<RowDataPacket[]>(query, params).catch(err => {
		console.error(err);
		throw err;
	});
	if (!rows || !rows.length) {
		throw new Error("No results found");
	} else if (rows.length > 1) {
		throw new Error("Multiple results found");
	}
	return rows[0] as T;
}

/**
 * Run a query on the database and return the results
 * @param query The query to run
 * @param params The parameters to use in the query
 * @returns The results of the query
 * @throws Error if the query fails
 */
export async function getAll<T>(query: string, params: (string | number)[]): Promise<T[]> {
	const [rows] = await db.execute<RowDataPacket[]>(query, params).catch(err => {
		console.error(err);
		throw err;
	});
	if (!rows) {
		throw new Error("No results found");
	}
	return rows as T[];
}