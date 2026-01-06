require('dotenv').config();

if (!globalThis.fetch) {
  globalThis.fetch = (...args) => import('node:fetch').then(({ default: fetch }) => fetch(...args));
}

const YOOKASSA_SHOP_ID = process.env.YOOKASSA_SHOP_ID;
const YOOKASSA_SECRET_KEY = process.env.YOOKASSA_SECRET_KEY;

function uuidv4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

async function createPayment(amount, description, metadata = {}) {
  const idempotenceKey = uuidv4();
  const url = 'https://api.yookassa.ru/v3/payments';

  const body = JSON.stringify({
    amount: { value: amount.toFixed(2), currency: 'RUB' },
    confirmation: { type: 'redirect', return_url: 'https://t.me/your_bot' },
    capture: true,
    description,
    metadata
  });

  const credentials = Buffer.from(`${YOOKASSA_SHOP_ID}:${YOOKASSA_SECRET_KEY}`).toString('base64');

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotence-Key': idempotenceKey,
      'Authorization': `Basic ${credentials}`
    },
    body
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`ЮKassa: ${response.status} – ${errorText}`);
  }

  return await response.json();
}

module.exports = { createPayment };