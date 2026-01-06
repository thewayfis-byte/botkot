const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.resolve(__dirname, 'database.sqlite'));

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id INTEGER UNIQUE NOT NULL,
    username TEXT,
    first_name TEXT,
    balance REAL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    price INTEGER NOT NULL,
    description TEXT,
    is_enabled INTEGER DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS key_pool (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    key_value TEXT NOT NULL UNIQUE,
    is_used INTEGER DEFAULT 0,
    used_at DATETIME,
    order_id INTEGER,
    FOREIGN KEY (product_id) REFERENCES products (id),
    FOREIGN KEY (order_id) REFERENCES orders (id)
  );

  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    status TEXT DEFAULT 'pending',
    payment_id TEXT,
    key TEXT,
    support_status TEXT DEFAULT 'none',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES products (id),
    FOREIGN KEY (user_id) REFERENCES users (telegram_id)
  );

  CREATE TABLE IF NOT EXISTS support_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    sender TEXT NOT NULL,
    text TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (order_id) REFERENCES orders (id)
  );

  CREATE TABLE IF NOT EXISTS wallet_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    amount REAL NOT NULL,
    type TEXT NOT NULL, -- 'deposit', 'withdrawal', 'purchase'
    description TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users (id)
  );
`);

// Демо-данные
try {
  if (db.prepare('SELECT COUNT(*) as c FROM products').get().c === 0) {
    db.prepare('INSERT INTO products (name, price, description) VALUES (?, ?, ?)')
      .run('Minecraft Java', 1999, 'Оригинальная лицензия');
    db.prepare('INSERT INTO key_pool (product_id, key_value) VALUES (1, ?)')
      .run('DEMO-KEY-12345');
  }
} catch (e) { console.log('Demo exists'); }

module.exports = db;