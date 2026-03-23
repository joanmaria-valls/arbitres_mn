// server/lib/db.mjs

import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

const DATABASE_FILE = 'database.db';

/**
 * Initializes the SQLite database and creates necessary tables if they do not exist.
 */
async function initializeDatabase() {
    const db = await open({
        filename: DATABASE_FILE,
        driver: sqlite3.Database
    });

    await db.exec(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE
    );`);

    await db.exec(`CREATE TABLE IF NOT EXISTS scores (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        score INTEGER,
        FOREIGN KEY(user_id) REFERENCES users(id)
    );`);

    await db.close();
}

/**
 * Adds a new user to the database.
 * @param {string} name - The name of the user.
 * @param {string} email - The email of the user.
 */
async function addUser(name, email) {
    const db = await open({
        filename: DATABASE_FILE,
        driver: sqlite3.Database
    });

    await db.run(`INSERT INTO users (name, email) VALUES (?, ?)`, [name, email]);
    await db.close();
}

/**
 * Retrieves all users from the database.
 * @returns {Array} - An array of users.
 */
async function getAllUsers() {
    const db = await open({
        filename: DATABASE_FILE,
        driver: sqlite3.Database
    });

    const users = await db.all(`SELECT * FROM users`);
    await db.close();
    return users;
}

export { initializeDatabase, addUser, getAllUsers };