const Database = require('better-sqlite3');
const db = new Database('./database.sqlite');

console.log('Таблицы в базе данных:');
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table';").all();
console.log(tables);

for (const table of tables) {
  console.log(`\nСтруктура таблицы: ${table.name}`);
  const columns = db.prepare(`PRAGMA table_info(${table.name})`).all();
  console.log(columns);
  
  // Выведем несколько записей из каждой таблицы
  try {
    const sample = db.prepare(`SELECT * FROM ${table.name} LIMIT 3`).all();
    console.log('Пример записей:', sample);
  } catch (e) {
    console.log('Ошибка при чтении записей:', e.message);
  }
}

db.close();