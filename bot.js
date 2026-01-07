require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const models = require('./models');
const { createPayment } = require('./yookassa');
const db = require('./database');

const bot = new Telegraf(process.env.BOT_TOKEN);

// Инициализация пользователя
function initUser(ctx) {
  if (!ctx.session) ctx.session = {};
  if (!ctx.session.wallet) ctx.session.wallet = 0;
}

// Приветственное меню
bot.start((ctx) => {
  initUser(ctx);
  ctx.reply(
    '👋 Добро пожаловать в наш магазин!\n\nВыберите действие:',
    Markup.keyboard([
      ['🔑 Ключи', '💳 Подписки'],
      ['💰 Пополнение Steam', '👤 Профиль'],
      ['💼 Кошелек', '🆘 Помощь']
    ]).resize()
  );
});

// Обработка команды /menu
bot.command('menu', (ctx) => {
  initUser(ctx);
  ctx.reply(
    '📋 Главное меню:\n\nВыберите действие:',
    Markup.keyboard([
      ['🔑 Ключи', '💳 Подписки'],
      ['💰 Пополнение Steam', '👤 Профиль'],
      ['💼 Кошелек', '🆘 Помощь']
    ]).resize()
  );
});

// Обработка кнопки "В главное меню"
bot.action('main_menu', (ctx) => {
  initUser(ctx);
  ctx.reply(
    '📋 Главное меню:\n\nВыберите действие:',
    Markup.keyboard([
      ['🔑 Ключи', '💳 Подписки'],
      ['💰 Пополнение Steam', '👤 Профиль'],
      ['💼 Кошелек', '🆘 Помощь']
    ]).resize()
  );
});

// Обработка нажатий на кнопки меню
bot.hears('🔑 Ключи', (ctx) => {
  const products = models.getActiveProducts();
  if (products.length === 0) return ctx.reply('🛒 Товары скоро появятся!');
  
  const buttons = products.map(p =>
    Markup.button.callback(`${p.name} — ${p.price} ₽`, `buy_${p.id}`)
  );
  buttons.push(Markup.button.callback('🔙 В главное меню', 'main_menu'));
  ctx.reply('🔑 Выберите лицензию:', Markup.inlineKeyboard(buttons));
});

bot.hears('💳 Подписки', (ctx) => {
  const products = models.getActiveProducts();
  if (products.length === 0) return ctx.reply('🛒 Подписки скоро появятся!');
  
  const buttons = products.map(p =>
    Markup.button.callback(`${p.name} — ${p.price} ₽`, `buy_${p.id}`)
  );
  buttons.push(Markup.button.callback('🔙 В главное меню', 'main_menu'));
  ctx.reply('💳 Выберите подписку:', Markup.inlineKeyboard(buttons));
});

bot.hears('💰 Пополнение Steam', (ctx) => {
  ctx.reply(
    '💰 Пополнение Steam Wallet\n\n' +
    'Введите сумму для пополнения (в рублях):\n' +
    'Комиссия: 7%\n\n' +
    'Пример: 1000 -> Вы получите 930 ₽ на Steam Wallet\n\n' +
    'Для возврата в главное меню нажмите /menu',
    Markup.inlineKeyboard([
      [Markup.button.callback('🔙 В главное меню', 'main_menu')]
    ])
  );
  ctx.session.waitingForSteamAmount = true;
});

bot.hears('👤 Профиль', (ctx) => {
  ctx.reply(
    `👤 Ваш профиль:\n` +
    `ID: ${ctx.from.id}\n` +
    `Имя: ${ctx.from.first_name} ${ctx.from.last_name || ''}\n` +
    `Username: @${ctx.from.username || 'не указан'}\n` +
    `Дата регистрации: ${new Date().toLocaleDateString()}\n\n` +
    'Для возврата в главное меню нажмите /menu',
    Markup.inlineKeyboard([
      [Markup.button.callback('🔙 В главное меню', 'main_menu')]
    ])
  );
});

bot.hears('💼 Кошелек', (ctx) => {
  initUser(ctx);
  ctx.reply(
    `💼 Ваш кошелек:\n` +
    `Баланс: ${ctx.session.wallet} ₽\n\n` +
    `Доступные действия:\n` +
    `💳 Пополнить\n\n` +
    'Для возврата в главное меню нажмите /menu',
    Markup.inlineKeyboard([
      [Markup.button.callback('💳 Пополнить', 'wallet_recharge')],
      [Markup.button.callback('🔙 В главное меню', 'main_menu')]
    ])
  );
});

bot.hears('🆘 Помощь', (ctx) => {
  ctx.reply(
    '🆘 Служба поддержки\n\n' +
    'Если у вас возникли проблемы, нажмите кнопку ниже для связи с поддержкой.\n\n' +
    'Администраторы получат ваш запрос и свяжутся с вами в ближайшее время.\n\n' +
    'Для возврата в главное меню нажмите /menu',
    Markup.inlineKeyboard([
      [Markup.button.callback('💬 Создать тикет', 'create_ticket')],
      [Markup.button.callback('🔙 В главное меню', 'main_menu')]
    ])
  );
});

// Обработка ввода суммы для пополнения Steam
bot.on('text', (ctx) => {
  if (ctx.session && ctx.session.waitingForSteamAmount) {
    const amount = parseInt(ctx.message.text);
    if (isNaN(amount) || amount <= 0) {
      return ctx.reply('❌ Пожалуйста, введите корректную сумму (положительное число)');
    }
    
    const commission = amount * 0.07;
    const finalAmount = amount - commission;
    
    ctx.reply(
      `💰 Пополнение Steam Wallet\n\n` +
      `Сумма: ${amount} ₽\n` +
      `Комиссия (7%): ${commission.toFixed(2)} ₽\n` +
      `Итого: ${finalAmount.toFixed(2)} ₽\n\n` +
      'Нажмите "Оплатить", чтобы продолжить:',
      Markup.inlineKeyboard([
        [Markup.button.callback('💳 Оплатить', `steam_pay_${amount}`)]
      ])
    );
    
    ctx.session.waitingForSteamAmount = false;
  } else if (ctx.session && ctx.session.waitingForWalletRecharge) {
    const amount = parseInt(ctx.message.text);
    if (isNaN(amount) || amount <= 0) {
      return ctx.reply('❌ Пожалуйста, введите корректную сумму (положительное число)');
    }
    
    ctx.reply(
      `💼 Пополнение кошелька\n\n` +
      `Сумма: ${amount} ₽\n\n` +
      'Нажмите "Оплатить", чтобы продолжить:',
      Markup.inlineKeyboard([
        [Markup.button.callback('💳 Оплатить', `wallet_pay_${amount}`)]
      ])
    );
    
    ctx.session.waitingForWalletRecharge = false;
  } else {
    // Обработка сообщений в поддержке
    const order = db.prepare(`
      SELECT id FROM orders
      WHERE user_id = ? AND support_status = 'open'
      ORDER BY created_at DESC
      LIMIT 1
    `).get(ctx.from.id);

    if (order) {
      models.saveMessage(order.id, 'user', ctx.message.text);
      ctx.reply('✅ Сообщение отправлено админу!');
    }
  }
});

// Обработка покупки
bot.action(/buy_(\d+)/, async (ctx) => {
  const productId = parseInt(ctx.match[1]);
  const product = models.getProductById(productId);
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

// Обработка оплаты Steam
bot.action(/steam_pay_(\d+)/, async (ctx) => {
  const amount = parseInt(ctx.match[1]);
  if (isNaN(amount) || amount <= 0) return ctx.answerCbQuery('Некорректная сумма');

  try {
    const commission = amount * 0.07;
    const totalAmount = amount;
    const description = `Пополнение Steam Wallet на ${amount} ₽`;

    const payment = await createPayment(
      totalAmount,
      description,
      { 
        orderId: `steam_${Date.now()}`,
        type: 'steam_replenishment',
        amount: amount
      }
    );

    await ctx.editMessageText(
      `💳 Оплатите пополнение Steam:\nСумма: *${totalAmount} ₽*\nКомиссия: *${commission.toFixed(2)} ₽*`,
      {
        parse_mode: 'Markdown',
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

// Проверка оплаты Steam
bot.action(/check_steam_(.+)_(\d+)/, async (ctx) => {
  const paymentId = ctx.match[1];
  const amount = parseInt(ctx.match[2]);
  
  try {
    const credentials = Buffer.from(
      `${process.env.YOOKASSA_SHOP_ID}:${process.env.YOOKASSA_SECRET_KEY}`
    ).toString('base64');
    
    const res = await fetch(`https://api.yookassa.ru/v3/payments/${paymentId}`, {
      headers: { 'Authorization': `Basic ${credentials}` }
    });
    
    if (!res.ok) throw new Error('ЮKassa error');
    const paymentStatus = (await res.json()).status;
    
    if (['succeeded', 'waiting_for_capture'].includes(paymentStatus)) {
      await ctx.editMessageText(
        `✅ Пополнение Steam Wallet успешно!\n\n` +
        `Сумма: ${amount} ₽\n` +
        `Комиссия: ${(amount * 0.07).toFixed(2)} ₽\n\n` +
        `Для получения ключа пополнения свяжитесь с поддержкой.`
      );
      
      // Уведомить администратора
      ctx.telegram.sendMessage(process.env.ADMIN_TG_ID, 
        `💰 Новое пополнение Steam от ${ctx.from.id}\nСумма: ${amount} ₽`
      );
    } else {
      ctx.answerCbQuery('Платёж не завершён. Попробуйте позже.');
    }
  } catch (err) {
    console.error(err);
    ctx.answerCbQuery('Ошибка проверки. Обратитесь в поддержку.');
  }
});

// Пополнение кошелька
bot.action('wallet_recharge', (ctx) => {
  ctx.reply('Введите сумму для пополнения кошелька:');
  if (!ctx.session) ctx.session = {};
  ctx.session.waitingForWalletRecharge = true;
});

bot.action(/wallet_pay_(\d+)/, async (ctx) => {
  const amount = parseInt(ctx.match[1]);
  if (isNaN(amount) || amount <= 0) return ctx.answerCbQuery('Некорректная сумма');

  try {
    const payment = await createPayment(
      amount,
      `Пополнение кошелька на ${amount} ₽`,
      { 
        orderId: `wallet_${Date.now()}`,
        type: 'wallet_replenishment',
        userId: ctx.from.id
      }
    );

    await ctx.editMessageText(
      `💳 Оплатите пополнение кошелька:\nСумма: *${amount} ₽*`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.url('Оплатить', payment.confirmation.confirmation_url)],
          [Markup.button.callback('🔄 Проверить оплату', `check_wallet_${payment.id}_${amount}`)]
        ])
      }
    );
  } catch (err) {
    console.error(err);
    ctx.answerCbQuery('Ошибка платежа. Попробуйте позже.');
  }
});

// Проверка оплаты кошелька
bot.action(/check_wallet_(.+)_(\d+)/, async (ctx) => {
  const paymentId = ctx.match[1];
  const amount = parseInt(ctx.match[2]);
  
  try {
    const credentials = Buffer.from(
      `${process.env.YOOKASSA_SHOP_ID}:${process.env.YOOKASSA_SECRET_KEY}`
    ).toString('base64');
    
    const res = await fetch(`https://api.yookassa.ru/v3/payments/${paymentId}`, {
      headers: { 'Authorization': `Basic ${credentials}` }
    });
    
    if (!res.ok) throw new Error('ЮKassa error');
    const paymentStatus = (await res.json()).status;
    
    if (['succeeded', 'waiting_for_capture'].includes(paymentStatus)) {
      initUser(ctx);
      ctx.session.wallet += amount;
      
      await ctx.editMessageText(
        `✅ Кошелек пополнен!\n\n` +
        `Сумма: ${amount} ₽\n` +
        `Новый баланс: ${ctx.session.wallet} ₽`
      );
    } else {
      ctx.answerCbQuery('Платёж не завершён. Попробуйте позже.');
    }
  } catch (err) {
    console.error(err);
    ctx.answerCbQuery('Ошибка проверки. Обратитесь в поддержку.');
  }
});

// Проверка оплаты обычных покупок
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
      const product = models.getProductById(order.product_id);
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

// Закрытие заказа
bot.action(/close_(\d+)/, (ctx) => {
  const orderId = parseInt(ctx.match[1]);
  const order = models.getOrderById(orderId);
  if (!order || order.user_id !== ctx.from.id) return;
  models.closeSupportChat(orderId);
  ctx.editMessageText('🔒 Заказ закрыт. Спасибо!');
});

// Создание тикета в поддержку
bot.action('create_ticket', (ctx) => {
  ctx.telegram.sendMessage(process.env.ADMIN_TG_ID, 
    `🆘 Новый тикет от пользователя ${ctx.from.id}\nИмя: ${ctx.from.first_name} ${ctx.from.last_name || ''}\nUsername: @${ctx.from.username || 'не указан'}`
  );
  ctx.reply('✅ Ваш тикет отправлен в поддержку. Администратор свяжется с вами в ближайшее время.');
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

module.exports = bot;