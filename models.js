const db = require('./database');

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

// Получить все заказы пользователя
function getUserOrders(userId) {
  return db.prepare('SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC')
    .all(userId);
}

// ЭКСПОРТ ВСЕХ ФУНКЦИЙ
module.exports = {
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
  getUserOrders
};