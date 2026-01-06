require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const models = require('./models');
const { createPayment } = require('./yookassa');
const db = require('./database');

const bot = new Telegraf(process.env.BOT_TOKEN);

// Старт
bot.start((ctx) => {
  // Создаем или обновляем информацию о пользователе
  models.getOrCreateUser(ctx.from.id, ctx.from.username, ctx.from.first_name);

  ctx.reply('👋 Привет! Добро пожаловать в нашего бота.\n\nВыберите действие:', Markup.keyboard([
    ['🔑 Ключи', '💳 Подписки'],
    ['🎮 Пополнение Стим', '👤 Профиль'],
    ['💰 Кошелек', '🆘 Помощь']
  ]).resize());
});

// Главное меню
bot.hears('🔑 Ключи', (ctx) => {
  const products = models.getActiveProducts();
  if (products.length === 0) return ctx.reply('🛒 Товары скоро появятся!');
  const buttons = products.map(p =>
    Markup.button.callback(`${p.name} — ${p.price} ₽`, `buy_${p.id}`)
  );
  ctx.reply('🔑 Выберите лицензию:', Markup.inlineKeyboard(buttons));
});

bot.hears('💳 Подписки', (ctx) => {
  ctx.reply('💳 Подписки временно недоступны. Выберите "Ключи" для приобретения лицензий.', Markup.keyboard([
    ['🔑 Ключи', '🎮 Пополнение Стим'],
    ['👤 Профиль', '💰 Кошелек'],
    ['🆘 Помощь']
  ]).resize());
});

bot.hears('🎮 Пополнение Стим', (ctx) => {
  ctx.reply('🎮 Укажите сумму пополнения Steam (комиссия 7%):', Markup.forceReply());
});

bot.hears('👤 Профиль', (ctx) => {
  const user = models.getUserByTelegramId(ctx.from.id);
  ctx.reply(`👤 Профиль пользователя\n\nID: ${ctx.from.id}\nИмя: ${ctx.from.first_name || 'Не указано'}\nUsername: ${ctx.from.username ? '@' + ctx.from.username : 'Не указан'}\nРегистрация: ${user ? new Date(user.created_at).toLocaleDateString() : 'Неизвестно'}`, Markup.keyboard([
    ['🔑 Ключи', '💳 Подписки'],
    ['🎮 Пополнение Стим', '💰 Кошелек'],
    ['🆘 Помощь']
  ]).resize());
});

bot.hears('💰 Кошелек', (ctx) => {
  const balance = models.getUserBalance(ctx.from.id);
  ctx.reply(`💰 Кошелек\n\nБаланс: ${balance.toFixed(2)} ₽\n\nДля пополнения кошелька выберите "Пополнение Стим" или воспользуйтесь командой /topup`, Markup.keyboard([
    ['🔑 Ключи', '💳 Подписки'],
    ['🎮 Пополнение Стим', '👤 Профиль'],
    ['🆘 Помощь']
  ]).resize());
});

bot.hears('🆘 Помощь', (ctx) => {
  ctx.reply('🆘 В случае возникновения проблем или вопросов, пожалуйста, воспользуйтесь формой обратной связи на нашем сайте: https://your-domain.com/ticket.html\n\nТакже вы можете написать нам напрямую в этот чат, и мы постараемся помочь вам.', Markup.keyboard([
    ['🔑 Ключи', '💳 Подписки'],
    ['🎮 Пополнение Стим', '👤 Профиль'],
    ['💰 Кошелек']
  ]).resize());
});

// Покупка
bot.action(/buy_(\\d+)/, async (ctx) => {
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

bot.action(/check_(\\d+)/, async (ctx) => {
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
bot.action(/close_(\\d+)/, (ctx) => {
  const orderId = parseInt(ctx.match[1]);
  const order = models.getOrderById(orderId);
  if (!order || order.user_id !== ctx.from.id) return;
  models.closeSupportChat(orderId);
  ctx.editMessageText('🔒 Заказ закрыт. Спасибо!');
});

// Помощь
bot.action(/help_(\\d+)/, (ctx) => {
  const orderId = parseInt(ctx.match[1]);
  const order = models.getOrderById(orderId);
  if (!order || order.user_id !== ctx.from.id) return;
  models.openSupportChat(orderId);
  ctx.telegram.sendMessage(process.env.ADMIN_TG_ID, `🆘 Новый запрос! Заказ #${orderId}`);
  ctx.editMessageText('👨‍🔧 Поддержка подключена!\nНапишите ваш вопрос:');
});

// Команда для пополнения кошелька
bot.command('topup', (ctx) => {
  ctx.reply('💳 Укажите сумму для пополнения кошелька:', Markup.forceReply());
});

// Обработка сообщений для пополнения кошелька и Steam
bot.on('text', (ctx) => {
  // Проверяем, не является ли это сообщение запросом на пополнение кошелька
  if (ctx.message && ctx.message.text && ctx.message.reply_to_message && 
      ctx.message.reply_to_message.text && 
      ctx.message.reply_to_message.text.includes('Укажите сумму для пополнения кошелька')) {
    const amount = parseFloat(ctx.message.text);
    if (amount > 0) {
      // Создание платежа через ЮKassa для пополнения кошелька
      createPayment(
        amount,
        `Пополнение кошелька: ${amount} ₽`,
        { 
          orderId: `wallet_topup_${Date.now()}`,
          userId: ctx.from.id,
          type: 'wallet_topup'
        }
      )
      .then(payment => {
        ctx.reply(
          `💳 Пополнение кошелька на ${amount} ₽`,
          Markup.inlineKeyboard([
            [Markup.button.url('Оплатить', payment.confirmation.confirmation_url)],
            [Markup.button.callback('🔄 Проверить оплату', `check_wallet_topup_${payment.id}_${amount}_${ctx.from.id}`)]
          ])
        );
      })
      .catch(err => {
        console.error(err);
        ctx.reply('❌ Ошибка при создании платежа. Попробуйте позже.');
      });
      return;
    } else {
      ctx.reply('❌ Некорректная сумма. Пожалуйста, укажите положительное число.');
      return;
    }
  }
  
  // Проверяем, не является ли это сообщение запросом на пополнение Steam
  if (ctx.message && ctx.message.text && !isNaN(ctx.message.text) && ctx.message.text.trim() !== '') {
    // Проверяем, является ли это числом (а не командой или другим текстом)
    const amount = parseFloat(ctx.message.text);
    if (amount > 0 && ctx.message.text.trim() === amount.toString()) {
      // Расчет суммы с комиссией 7%
      const commission = amount * 0.07;
      const totalAmount = amount + commission;
      
      ctx.reply(`🎮 Пополнение Steam на сумму ${amount} ₽\nКомиссия (7%): ${commission.toFixed(2)} ₽\nИтого к оплате: ${totalAmount.toFixed(2)} ₽`, 
        Markup.inlineKeyboard([
          [Markup.button.callback('💳 Оплатить', `steam_replenishment_${amount}`)]
        ])
      );
      return;
    }
  }
  
  // Обработка сообщений в поддержке
  const activeOrder = db.prepare(`
    SELECT * FROM orders
    WHERE user_id = ? AND support_status = 'open'
  `).get(ctx.from.id);

  if (activeOrder) {
    models.saveMessage(activeOrder.id, 'user', ctx.message.text);
    
    // Отправляем сообщение администратору
    ctx.telegram.sendMessage(process.env.ADMIN_TG_ID, 
      `🆘 Новый запрос в поддержке!\nПользователь: ${ctx.from.first_name} (@${ctx.from.username || 'не указан'})\nID: ${ctx.from.id}\nСообщение: ${ctx.message.text}`
    );
    
    ctx.reply('✅ Сообщение отправлено в поддержку!');
    return;
  }

  // Если не поддержка и не пополнение Steam, то обычный ответ
  ctx.reply('Выберите действие из меню:', Markup.keyboard([
    ['🔑 Ключи', '💳 Подписки'],
    ['🎮 Пополнение Стим', '👤 Профиль'],
    ['💰 Кошелек', '🆘 Помощь']
  ]).resize());
});

// Обработка оплаты пополнения Steam
bot.action(/steam_replenishment_(.+)/, async (ctx) => {
  const amount = parseFloat(ctx.match[1]);
  if (isNaN(amount) || amount <= 0) {
    ctx.answerCbQuery('Некорректная сумма');
    return;
  }
  
  const commission = amount * 0.07;
  const totalAmount = amount + commission;
  
  try {
    const payment = await createPayment(
      totalAmount,
      `Пополнение Steam: ${amount} ₽`,
      { 
        orderId: `steam_${Date.now()}`,
        userId: ctx.from.id,
        type: 'steam_replenishment',
        originalAmount: amount
      }
    );
    
    await ctx.editMessageText(
      `🎮 Пополнение Steam:\nСумма: ${amount} ₽\nКомиссия (7%): ${commission.toFixed(2)} ₽\nИтого: ${totalAmount.toFixed(2)} ₽`,
      {
        ...Markup.inlineKeyboard([
          [Markup.button.url('Оплатить', payment.confirmation.confirmation_url)],
          [Markup.button.callback('🔄 Проверить оплату', `check_steam_${payment.id}_${amount}`)]
        ])
      }
    );
  } catch (err) {
    console.error(err);
    ctx.answerCbQuery('Ошибка платежа. Попробуйте позже.');
  }
});

// Проверка оплаты пополнения Steam
bot.action(/check_steam_(.+)_(.+)/, async (ctx) => {
  const [paymentId, amount] = [ctx.match[1], parseFloat(ctx.match[2])];
  
  try {
    const credentials = Buffer.from(
      `${process.env.YOOKASSA_SHOP_ID}:${process.env.YOOKASSA_SECRET_KEY}`
    ).toString('base64');
    
    const res = await fetch(`https://api.yookassa.ru/v3/payments/${paymentId}`, {
      headers: { 'Authorization': `Basic ${credentials}` }
    });
    
    if (!res.ok) throw new Error('ЮKassa error');
    
    const paymentData = await res.json();
    const status = paymentData.status;
    
    if (['succeeded', 'waiting_for_capture'].includes(status)) {
      await ctx.editMessageText(
        `✅ Пополнение Steam успешно!\nСумма: ${amount} ₽\n\nВаша заявка на пополнение принята. В ближайшее время с вами свяжутся для уточнения реквизитов.`
      );
      
      // Уведомление администратору
      ctx.telegram.sendMessage(process.env.ADMIN_TG_ID, 
        `🎮 Новый запрос на пополнение Steam!\nПользователь: ${ctx.from.first_name} (@${ctx.from.username || 'не указан'})\nID: ${ctx.from.id}\nСумма: ${amount} ₽`
      );
    } else {
      ctx.answerCbQuery('Платёж не завершён. Попробуйте позже.');
    }
  } catch (err) {
    console.error(err);
    ctx.answerCbQuery('Ошибка проверки. Обратитесь в поддержку.');
  }
});

// Проверка оплаты пополнения кошелька
bot.action(/check_wallet_topup_(.+)_(.+)_(.+)/, async (ctx) => {
  const [paymentId, amount, userId] = [ctx.match[1], parseFloat(ctx.match[2]), parseInt(ctx.match[3])];
  
  try {
    const credentials = Buffer.from(
      `${process.env.YOOKASSA_SHOP_ID}:${process.env.YOOKASSA_SECRET_KEY}`
    ).toString('base64');
    
    const res = await fetch(`https://api.yookassa.ru/v3/payments/${paymentId}`, {
      headers: { 'Authorization': `Basic ${credentials}` }
    });
    
    if (!res.ok) throw new Error('ЮKassa error');
    
    const paymentData = await res.json();
    const status = paymentData.status;
    
    if (['succeeded', 'waiting_for_capture'].includes(status)) {
      // Обновляем баланс пользователя
      models.updateUserBalance(userId, amount);
      
      await ctx.editMessageText(
        `✅ Кошелек пополнен на ${amount} ₽\nТеперь вы можете использовать средства для покупок в боте.`
      );
    } else {
      ctx.answerCbQuery('Платёж не завершён. Попробуйте позже.');
    }
  } catch (err) {
    console.error(err);
    ctx.answerCbQuery('Ошибка проверки. Обратитесь в поддержку.');
  }
});

module.exports = bot;