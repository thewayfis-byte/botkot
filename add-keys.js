const db = require('./database');
const productId = 1; // ID твоего товара
const keys = ['KEY1-AAAA', 'KEY2-BBBB', 'KEY3-CCCC'];

keys.forEach(k => {
  db.prepare('INSERT INTO key_pool (product_id, key_value) VALUES (?, ?)').run(productId, k);
});
console.log('✅ Ключи добавлены');