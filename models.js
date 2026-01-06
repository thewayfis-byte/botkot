const db = require('./database');

// Получить или создать пользователя
function getOrCreateUser(telegramId, username, firstName) {
  let user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegramId);
  if (!user) {
    db.prepare('INSERT INTO users (telegram_id, username, first_name) VALUES (?, ?, ?)')
      .run(telegramId, username, firstName);
    user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegramId);
  } else {
    // Обновляем имя и username, если они изменились
    db.prepare('UPDATE users SET username = ?, first_name = ? WHERE telegram_id = ?')
      .run(username, firstName, telegramId);
  }
  return user;
}

// Получить пользователя по Telegram ID
function getUserByTelegramId(telegramId) {
  return db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegramId);
}

// Обновить баланс пользователя
function updateUserBalance(telegramId, amount) {
  db.prepare('UPDATE users SET balance = balance + ? WHERE telegram_id = ?').run(amount, telegramId);
  // Записываем транзакцию
  db.prepare('INSERT INTO wallet_transactions (user_id, amount, type, description) VALUES (?, ?, ?, ?)')
    .run(
      db.prepare('SELECT id FROM users WHERE telegram_id = ?').get(telegramId).id,
      amount,
      amount > 0 ? 'deposit' : 'withdrawal',
      amount > 0 ? 'Пополнение кошелька' : 'Оплата'
    );
}

// Получить баланс пользователя
function getUserBalance(telegramId) {
  const user = db.prepare('SELECT balance FROM users WHERE telegram_id = ?').get(telegramId);
  return user ? user.balance : 0;
}

// Получить историю транзакций пользователя
function getUserTransactions(telegramId) {
  return db.prepare(`
    SELECT wt.*, u.username 
    FROM wallet_transactions wt
    JOIN users u ON wt.user_id = u.id
    WHERE u.telegram_id = ?
    ORDER BY wt.created_at DESC
  `).all(telegramId);
}

// Получить активные товары
function getActiveProducts() {
  return db.prepare('SELECT * FROM products WHERE is_enabled = 1').all();
}

// Получить товар по ID
function getProductById(id) {
  return db.prepare('SELECT * FROM products WHERE id = ?').get(id);
}

// Создать заказ
function createOrder(userId, productId) {
  return db.prepare('INSERT INTO orders (user_id, product_id) VALUES (?, ?)')
    .run(userId, productId).lastInsertRowid;
}

// Получить заказ по ID
function getOrderById(id) {
  return db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
}

// Обновить заказ
function updateOrder(id, data) {
  const fields = Object.keys(data).map(k => `${k} = ?`).join(', ');
  db.prepare(`UPDATE orders SET ${fields} WHERE id = ?`).run(...Object.values(data), id);
}

// Найти свободный ключ для товара
function getFreeKeyForProduct(productId) {
  return db.prepare('SELECT * FROM key_pool WHERE product_id = ? AND is_used = 0 LIMIT 1').get(productId);
}

// Зарезервировать ключ за заказом
function reserveKey(keyId, orderId) {
  db.prepare('UPDATE key_pool SET is_used = 1, used_at = CURRENT_TIMESTAMP, order_id = ? WHERE id = ?')
    .run(orderId, keyId);
}

// Добавить ключ в пул
function addKey(productId, keyValue) {
  db.prepare('INSERT INTO key_pool (product_id, key_value) VALUES (?, ?)').run(productId, keyValue);
}

// Открыть чат поддержки
function openSupportChat(orderId) {
  db.prepare('UPDATE orders SET support_status = ? WHERE id = ?').run('open', orderId);
}

// Закрыть чат поддержки
function closeSupportChat(orderId) {
  db.prepare('UPDATE orders SET support_status = ? WHERE id = ?').run('closed', orderId);
}

// Сохранить сообщение в чате
function saveMessage(orderId, sender, text) {
  db.prepare('INSERT INTO support_messages (order_id, sender, text) VALUES (?, ?, ?)')
    .run(orderId, sender, text);
}

// Получить историю чата
function getChatHistory(orderId) {
  return db.prepare('SELECT * FROM support_messages WHERE order_id = ? ORDER BY created_at ASC')
    .all(orderId);
}

// Получить статистику для админки
function getAdminStats() {
  const stats = {};
  stats.orders = db.prepare('SELECT COUNT(*) as c FROM orders').get().c;
  stats.openChats = db.prepare('SELECT COUNT(*) as c FROM orders WHERE support_status = ?').get('open').c;
  stats.keys = db.prepare('SELECT COUNT(*) as c FROM key_pool WHERE is_used = 0').get().c;
  stats.users = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
  stats.totalIncome = db.prepare(`
    SELECT COALESCE(SUM(p.price), 0) as total 
    FROM orders o 
    JOIN products p ON o.product_id = p.id 
    WHERE o.status = 'paid'
  `).get().total;
  stats.todayIncome = db.prepare(`
    SELECT COALESCE(SUM(p.price), 0) as total 
    FROM orders o 
    JOIN products p ON o.product_id = p.id 
    WHERE o.status = 'paid' AND DATE(o.created_at) = DATE('now')
  `).get().total;
  stats.monthIncome = db.prepare(`
    SELECT COALESCE(SUM(p.price), 0) as total 
    FROM orders o 
    JOIN products p ON o.product_id = p.id 
    WHERE o.status = 'paid' AND strftime('%Y-%m', o.created_at) = strftime('%Y-%m', 'now')
  `).get().total;
  return stats;
}

// Получить статистику за определенный период
function getIncomeStats(startDate, endDate) {
  const total = db.prepare(`
    SELECT COALESCE(SUM(p.price), 0) as total 
    FROM orders o 
    JOIN products p ON o.product_id = p.id 
    WHERE o.status = 'paid' AND o.created_at BETWEEN ? AND ?
  `).get(startDate, endDate).total;
  
  const ordersCount = db.prepare(`
    SELECT COUNT(*) as count
    FROM orders o
    WHERE o.status = 'paid' AND o.created_at BETWEEN ? AND ?
  `).get(startDate, endDate).count;
  
  return { total, ordersCount };
}

// ЭКСПОРТ ВСЕХ ФУНКЦИЙ
module.exports = {
  getOrCreateUser,
  getUserByTelegramId,
  updateUserBalance,
  getUserBalance,
  getUserTransactions,
  getActiveProducts,
  getProductById,
  createOrder,
  getOrderById,
  updateOrder,
  getFreeKeyForProduct,
  reserveKey,
  addKey,
  openSupportChat,
  closeSupportChat,
  saveMessage,
  getChatHistory,
  getAdminStats,
  getIncomeStats
};