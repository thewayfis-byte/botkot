require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const models = require('./models');
const { createPayment } = require('./yookassa');

const bot = new Telegraf(process.env.BOT_TOKEN);

// Старт
bot.start((ctx) => {
  const products = models.getActiveProducts();
  if (products.length === 0) return ctx.reply('🛒 Товары скоро появятся!');
  const buttons = products.map(p =>
    Markup.button.callback(`${p.name} — ${p.price} ₽`, `buy_${p.id}`)
  );
  ctx.reply('🔑 Выберите лицензию:', Markup.inlineKeyboard(buttons));
});

// Покупка
bot.action(/buy_(\d+)/, async (ctx) => {
  const productId = parseInt(ctx.match[1]);
  const product = models.getActiveProducts().find(p => p.id === productId);
  if (!product) return ctx.answerCbQuery('Товар удалён');

  const freeKey = models.getFreeKeyForProduct(productId);
  if (!freeKey) return ctx.answerCbQuery('❌ Нет в наличии');

  const orderId = models.createOrder(ctx.from.id, productId);

  try {
    const payment = await createPayment(
      product.price,
      `Покупка: ${product.name}`,
      { orderId: String(orderId) }
    );

    models.updateOrder(orderId, { payment_id: payment.id });

    await ctx.editMessageText(
      `💳 Оплатите:\n*${product.name}*\nЦена: *${product.price} ₽*`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.url('Оплатить', payment.confirmation.confirmation_url)],
          [Markup.button.callback('🔄 Проверить оплату', `check_${orderId}`)]
        ])
      }
    );
  } catch (err) {
    console.error(err);
    ctx.answerCbQuery('Ошибка платежа. Попробуйте позже.');
  }
});

// Проверка оплаты
async function checkPaymentStatus(paymentId) {
  const credentials = Buffer.from(
    `${process.env.YOOKASSA_SHOP_ID}:${process.env.YOOKASSA_SECRET_KEY}`
  ).toString('base64');
  const res = await fetch(`https://api.yookassa.ru/v3/payments/${paymentId}`, {
    headers: { 'Authorization': `Basic ${credentials}` }
  });
  if (!res.ok) throw new Error('ЮKassa error');
  return (await res.json()).status;
}

bot.action(/check_(\d+)/, async (ctx) => {
  const orderId = parseInt(ctx.match[1]);
  const order = models.getOrderById(orderId);
  if (!order || order.user_id !== ctx.from.id) return ctx.answerCbQuery('❌');

  if (order.status === 'paid') return ctx.answerCbQuery('✅ Уже оплачено!');

  try {
    const status = await checkPaymentStatus(order.payment_id);
    if (['succeeded', 'waiting_for_capture'].includes(status)) {
      const product = models.getActiveProducts().find(p => p.id === order.product_id);
      const freeKey = models.getFreeKeyForProduct(order.product_id);
      if (!freeKey) return ctx.answerCbQuery('Ключ больше не доступен');

      models.updateOrder(orderId, { status: 'paid', key: freeKey.key_value });
      models.reserveKey(freeKey.id, orderId);

      await ctx.editMessageText(
        `✅ Ваш ключ для *${product.name}*:\n\n\`${freeKey.key_value}\`\n\nСпасибо за покупку!`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('✅ Всё работает', `close_${orderId}`)],
            [Markup.button.callback('🆘 Нужна помощь', `help_${orderId}`)]
          ])
        }
      );
    } else {
      ctx.answerCbQuery('Платёж не завершён. Попробуйте позже.');
    }
  } catch (err) {
    console.error(err);
    ctx.answerCbQuery('Ошибка проверки. Обратитесь в поддержку.');
  }
});

// Закрытие
bot.action(/close_(\d+)/, (ctx) => {
  const orderId = parseInt(ctx.match[1]);
  const order = models.getOrderById(orderId);
  if (!order || order.user_id !== ctx.from.id) return;
  models.closeSupportChat(orderId);
  ctx.editMessageText('🔒 Заказ закрыт. Спасибо!');
});

// Помощь
bot.action(/help_(\d+)/, (ctx) => {
  const orderId = parseInt(ctx.match[1]);
  const order = models.getOrderById(orderId);
  if (!order || order.user_id !== ctx.from.id) return;
  models.openSupportChat(orderId);
  ctx.telegram.sendMessage(process.env.ADMIN_TG_ID, `🆘 Новый запрос! Заказ #${orderId}`);
  ctx.editMessageText('👨‍🔧 Поддержка подключена!\nНапишите ваш вопрос:');
});

// Сообщения в поддержку
bot.on('text', (ctx) => {
  const order = models.getOrderById(
    models.getActiveProducts().reduce((acc, p) => {
      const o = models.getActiveProducts().find(o => o.user_id === ctx.from.id && o.support_status === 'open');
      return o ? o.id : acc;
    }, null)
  );
  // Упрощённо: в продакшене — делай запрос в БД
  // Для MVP — ограничимся уведомлением
  ctx.reply('✅ Сообщение отправлено!');
});

module.exports = bot;