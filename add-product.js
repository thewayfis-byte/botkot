const db = require('./database');

// Параметры товара — меняй их под себя!
const productName = "Minecraft Java Edition";
const price = 1999; // в рублях
const description = "Оригинальная лицензия Minecraft Java";

// Добавляем в БД
const stmt = db.prepare(`
  INSERT INTO products (name, price, description, is_enabled)
  VALUES (?, ?, ?, 1)
`);
stmt.run(productName, price, description);

console.log(`✅ Товар "${productName}" добавлен в магазин!`);