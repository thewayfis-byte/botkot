require('dotenv').config();
const express = require('express');
const session = require('express-session');
const http = require('http');
const { Server } = require('socket.io');
const { Telegraf, Markup } = require('telegraf');
const path = require('path');
const helmet = require('helmet');


const db = require('./database');
const models = require('./models');
const { createPayment } = require('./yookassa');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });
const bot = new Telegraf(process.env.BOT_TOKEN);

// Security middleware
app.use(helmet());

// Делаем io и bot доступными в маршрутах
app.locals.io = io;
app.locals.bot = bot;

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());


app.use(session({
  secret: process.env.SESSION_SECRET || 'secret123',
  resave: false,
  saveUninitialized: false
}));

// ======= SOCKET.IO =======
io.on('connection', (socket) => {
  socket.on('join-chat', (orderId) => {
    socket.join(`chat-${orderId}`);
  });
});

// ======= TELEGRAM БОТ =======

// Главное меню
function mainMenu() {
  return Markup.keyboard([
    ['🔑 Ключи', '💳 Подписки'],
    ['💰 Пополнение Steam', '👤 Профиль'],
    ['💼 Кошелек', '🆘 Помощь']
  ]).resize();
}

// Меню навигации
function backMenu() {
  return Markup.keyboard([
    ['В главное меню']
  ]).resize();
}

bot.start((ctx) => {
  ctx.reply('👋 Привет! Добро пожаловать в Wayfis!\n\nВыберите интересующий вас раздел:', mainMenu());
});

// Обработка команды /menu
bot.command('menu', (ctx) => {
  ctx.reply('📋 Главное меню:', mainMenu());
});

// Обработка нажатий на кнопки главного меню
bot.hears('🔑 Ключи', (ctx) => {
  const products = models.getActiveProducts();
  if (products.length === 0) return ctx.reply('🛒 Товары скоро появятся!');

  const buttons = products.map(p =>
    Markup.button.callback(`${p.name} — ${p.price} ₽`, `buy_${p.id}`)
  );
  ctx.reply('🔑 Выберите лицензию:', Markup.inlineKeyboard(buttons));
});

bot.hears('💳 Подписки', (ctx) => {
  ctx.reply('💳 Раздел подписок\n\nЗдесь вы можете приобрести подписку на наши услуги. В данный момент раздел в разработке.', backMenu());
});

bot.hears('💰 Пополнение Steam', (ctx) => {
  ctx.reply('Введите сумму для пополнения Steam кошелька (минимальная сумма 100 ₽):', backMenu());
  // Устанавливаем состояние для ожидания суммы
  ctx.session = ctx.session || {};
  ctx.session.waitingForSteamAmount = true;
});

bot.hears('👤 Профиль', (ctx) => {
  const user = models.getUserById(ctx.from.id);
  const userBalance = models.getUserBalance(ctx.from.id);
  ctx.reply(`👤 Ваш профиль:\n\nID: ${ctx.from.id}\nИмя: ${ctx.from.first_name || 'Не указано'}\nБаланс: ${userBalance} ₽`, backMenu());
});

bot.hears('💼 Кошелек', (ctx) => {
  const userBalance = models.getUserBalance(ctx.from.id);
  ctx.reply(`💼 Ваш кошелек:\n\nБаланс: ${userBalance} ₽\n\nДля пополнения кошелька нажмите на кнопку ниже:`, 
    Markup.keyboard([
      ['Пополнить кошелек', 'Списать с кошелька'],
      ['В главное меню']
    ]).resize()
  );
});

bot.hears('Пополнить кошелек', (ctx) => {
  ctx.reply('Введите сумму для пополнения кошелька:', backMenu());
  // Устанавливаем состояние для ожидания суммы
  ctx.session = ctx.session || {};
  ctx.session.waitingForWalletAmount = true;
});

bot.hears('Списать с кошелька', (ctx) => {
  ctx.reply('Введите сумму для списания с кошелька:', backMenu());
  // Устанавливаем состояние для ожидания суммы
  ctx.session = ctx.session || {};
  ctx.session.waitingForWithdrawAmount = true;
});

bot.hears('🆘 Помощь', (ctx) => {
  ctx.reply('Напишите ваш вопрос в поддержку:', backMenu());
  // Устанавливаем состояние для ожидания сообщения в поддержку
  ctx.session = ctx.session || {};
  ctx.session.waitingForSupportMessage = true;
});

// Обработка возврата в главное меню
bot.hears('В главное меню', (ctx) => {
  ctx.reply('📋 Главное меню:', mainMenu());
});

// Обработка ввода суммы для пополнения Steam
bot.on('text', async (ctx) => {
  const text = ctx.message.text;
  ctx.session = ctx.session || {};
  
  // Проверяем, ожидаем ли мы сумму для пополнения Steam
  if (ctx.session.waitingForSteamAmount) {
    const amount = parseInt(text);
    if (isNaN(amount) || amount < 100) {
      ctx.reply('❌ Неверная сумма. Минимальная сумма 100 ₽');
      ctx.session.waitingForSteamAmount = false;
      return;
    }
    
    const commission = amount * 0.07; // 7% комиссии
    const totalAmount = amount + commission;
    
    try {
      const payment = await createPayment(
        totalAmount,
        `Пополнение Steam на ${amount} ₽ (комиссия 7%)`,
        { userId: String(ctx.from.id), type: 'steam_replenishment' }
      );
      
      ctx.reply(
        `💳 Пополнение Steam на ${amount} ₽\nКомиссия: ${commission.toFixed(2)} ₽\nИтого к оплате: ${totalAmount.toFixed(2)} ₽`,
        Markup.inlineKeyboard([
          [Markup.button.url('Оплатить', payment.confirmation.confirmation_url)],
          [Markup.button.callback('🔄 Проверить оплату', `check_steam_${payment.id}_${amount}`)]
        ])
      );
      
      ctx.session.waitingForSteamAmount = false;
    } catch (err) {
      console.error('PAYMENT ERROR:', err);
      ctx.reply('Ошибка платежа. Попробуйте позже.');
      ctx.session.waitingForSteamAmount = false;
    }
  }
  // Проверяем, ожидаем ли мы сумму для пополнения кошелька
  else if (ctx.session.waitingForWalletAmount) {
    const amount = parseInt(text);
    if (isNaN(amount) || amount < 100) {
      ctx.reply('❌ Неверная сумма. Минимальная сумма 100 ₽');
      ctx.session.waitingForWalletAmount = false;
      return;
    }
    
    try {
      const payment = await createPayment(
        amount,
        `Пополнение кошелька на ${amount} ₽`,
        { userId: String(ctx.from.id), type: 'wallet_replenishment' }
      );
      
      ctx.reply(
        `💳 Пополнение кошелька на ${amount} ₽`,
        Markup.inlineKeyboard([
          [Markup.button.url('Оплатить', payment.confirmation.confirmation_url)],
          [Markup.button.callback('🔄 Проверить оплату', `check_wallet_${payment.id}_${amount}`)]
        ])
      );
      
      ctx.session.waitingForWalletAmount = false;
    } catch (err) {
      console.error('PAYMENT ERROR:', err);
      ctx.reply('Ошибка платежа. Попробуйте позже.');
      ctx.session.waitingForWalletAmount = false;
    }
  }
  // Проверяем, ожидаем ли мы сумму для списания с кошелька
  else if (ctx.session.waitingForWithdrawAmount) {
    const amount = parseInt(text);
    const userBalance = models.getUserBalance(ctx.from.id);
    
    if (isNaN(amount) || amount <= 0) {
      ctx.reply('❌ Неверная сумма.');
      ctx.session.waitingForWithdrawAmount = false;
      return;
    }
    
    if (amount > userBalance) {
      ctx.reply('❌ Недостаточно средств на кошельке.');
      ctx.session.waitingForWithdrawAmount = false;
      return;
    }
    
    // Списание средств с кошелька
    models.updateUserBalance(ctx.from.id, userBalance - amount);
    ctx.reply(`✅ Списание ${amount} ₽ с кошелька успешно выполнено.\nТекущий баланс: ${userBalance - amount} ₽`, backMenu());
    ctx.session.waitingForWithdrawAmount = false;
  }
  // Проверяем, ожидаем ли мы сообщение в поддержку
  else if (ctx.session.waitingForSupportMessage) {
    // Отправляем сообщение в поддержку (например, админу)
    ctx.telegram.sendMessage(
      process.env.ADMIN_TG_ID,
      `🆘 Новый запрос в поддержку!\nПользователь: ${ctx.from.first_name} (@${ctx.from.username || 'не указан'})\nID: ${ctx.from.id}\n\nСообщение: ${text}`
    );
    
    ctx.reply('✅ Ваше сообщение отправлено в поддержку. Ожидайте ответа.', backMenu());
    ctx.session.waitingForSupportMessage = false;
  }
  // Обработка сообщений от пользователя в чате поддержки (оставляем существующую логику)
  else {
    const order = db.prepare(`
      SELECT * FROM orders
      WHERE user_id = ? AND support_status = 'open'
    `).get(ctx.from.id);

    if (!order) return;

    models.saveMessage(order.id, 'user', ctx.message.text);

    // Отправляем событие в админку
    const io = app.locals.io;
    io.to(`chat-${order.id}`).emit('new-message', {
      sender: 'user',
      text: ctx.message.text,
      time: new Date().toLocaleTimeString()
    });

    await ctx.reply('✅ Сообщение отправлено админу!');
  }
});

bot.action(/check_steam_(.+)_(\d+)/, async (ctx) => {
  const paymentId = ctx.match[1];
  const amount = parseInt(ctx.match[2]);
  
  try {
    const status = await checkPaymentStatus(paymentId);
    if (['succeeded', 'waiting_for_capture'].includes(status)) {
      // Пополнение Steam успешно
      ctx.editMessageText(`✅ Пополнение Steam на ${amount} ₽ успешно выполнено!`);
    } else {
      ctx.answerCbQuery('Платёж не завершён. Попробуйте позже.');
    }
  } catch (err) {
    console.error('CHECK ERROR:', err);
    ctx.answerCbQuery('Ошибка проверки. Обратитесь в поддержку.');
  }
});

bot.action(/check_wallet_(.+)_(\d+)/, async (ctx) => {
  const paymentId = ctx.match[1];
  const amount = parseInt(ctx.match[2]);
  
  try {
    const status = await checkPaymentStatus(paymentId);
    if (['succeeded', 'waiting_for_capture'].includes(status)) {
      // Пополнение кошелька успешно
      const userBalance = models.getUserBalance(ctx.from.id);
      models.updateUserBalance(ctx.from.id, userBalance + amount);
      ctx.editMessageText(`✅ Кошелек пополнен на ${amount} ₽!\nТекущий баланс: ${userBalance + amount} ₽`);
    } else {
      ctx.answerCbQuery('Платёж не завершён. Попробуйте позже.');
    }
  } catch (err) {
    console.error('CHECK ERROR:', err);
    ctx.answerCbQuery('Ошибка проверки. Обратитесь в поддержку.');
  }
});

bot.action(/buy_(\d+)/, async (ctx) => {
  const productId = parseInt(ctx.match[1]);
  const product = models.getProductById(productId);
  if (!product) return ctx.answerCbQuery('Товар не найден');

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
    console.error('PAYMENT ERROR:', err);
    ctx.answerCbQuery('Ошибка платежа. Попробуйте позже.');
  }
});

async function checkPaymentStatus(paymentId) {
  const credentials = Buffer.from(
    `${process.env.YOOKASSA_SHOP_ID}:${process.env.YOOKASSA_SECRET_KEY}`
  ).toString('base64');

  const response = await fetch(`https://api.yookassa.ru/v3/payments/${paymentId}`, {
    headers: { 'Authorization': `Basic ${credentials}` }
  });

  if (!response.ok) throw new Error('ЮKassa error');
  return (await response.json()).status;
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
    console.error('CHECK ERROR:', err);
    ctx.answerCbQuery('Ошибка проверки. Обратитесь в поддержку.');
  }
});

bot.action(/close_(\d+)/, (ctx) => {
  const orderId = parseInt(ctx.match[1]);
  const order = models.getOrderById(orderId);
  if (!order || order.user_id !== ctx.from.id) return;
  models.closeSupportChat(orderId);
  ctx.editMessageText('🔒 Заказ закрыт. Спасибо!');
});

bot.action(/help_(\d+)/, (ctx) => {
  const orderId = parseInt(ctx.match[1]);
  const order = models.getOrderById(orderId);
  if (!order || order.user_id !== ctx.from.id) return;

  models.openSupportChat(orderId);

  ctx.telegram.sendMessage(
    process.env.ADMIN_TG_ID,
    `🆘 Новый запрос поддержки!\nЗаказ #${orderId}\n\nАдмин, зайдите в админку!`
  );

  ctx.editMessageText('👨‍🔧 Поддержка подключена!\nНапишите ваш вопрос:');
});

// Сохранение сообщений от пользователя + отправка в админку
bot.on('text', async (ctx) => {
  const order = db.prepare(`
    SELECT * FROM orders
    WHERE user_id = ? AND support_status = 'open'
  `).get(ctx.from.id);

  if (!order) return;

  models.saveMessage(order.id, 'user', ctx.message.text);

  // Отправляем событие в админку
  const io = app.locals.io;
  io.to(`chat-${order.id}`).emit('new-message', {
    sender: 'user',
    text: ctx.message.text,
    time: new Date().toLocaleTimeString()
  });

  await ctx.reply('✅ Сообщение отправлено админу!');
});

// Обработка вебхуков от ЮKassa
app.post('/yookassa-webhook', express.json(), async (req, res) => {
  try {
    const event = req.body;
    
    if (event.event === 'payment.succeeded') {
      const payment = event.object;
      const metadata = payment.metadata;
      
      // Проверяем тип платежа
      if (metadata.type === 'wallet_replenishment') {
        // Пополнение кошелька
        const userId = parseInt(metadata.userId);
        const amount = Math.round(parseFloat(payment.amount.value));
        const currentBalance = models.getUserBalance(userId);
        models.updateUserBalance(userId, currentBalance + amount);
      } 
      else if (metadata.type === 'steam_replenishment') {
        // Пополнение Steam - в реальной системе тут была бы интеграция с Steam API
        // Пока просто логируем успешное пополнение
        console.log(`Пополнение Steam для пользователя ${metadata.userId} на сумму ${payment.amount.value} ₽`);
      }
    }
    
    res.status(200).send('OK');
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).send('Error');
  }
});


app.get('/', (req, res) => {
  res.redirect('/login');
});

app.get('/login', (req, res) => {
  const error = req.query.error || '';
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Вход в админку - Wayfis</title>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
      <style>
        body { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); min-height: 100vh; }
        .login-card { background: white; border-radius: 15px; box-shadow: 0 10px 30px rgba(0,0,0,0.2); }
      </style>
    </head>
    <body>
      <div class="container d-flex align-items-center justify-content-center min-vh-100">
        <div class="col-md-6 col-lg-5">
          <div class="login-card p-5">
            <h2 class="text-center mb-4">🔐 Вход в админку</h2>
            ${error ? `<div class="alert alert-danger">${error}</div>` : ''}
            <form method="POST" action="/login">
              <div class="mb-3">
                <label class="form-label">Логин</label>
                <input type="text" name="username" class="form-control" required>
              </div>
              <div class="mb-3">
                <label class="form-label">Пароль</label>
                <input type="password" name="password" class="form-control" required>
              </div>
              <button type="submit" class="btn btn-primary w-100">Войти</button>
            </form>
          </div>
        </div>
      </div>
    </body>
    </html>
  `);
});
app.post('/login', (req, res) => {
  if (req.body.username === process.env.ADMIN_LOGIN &&
      req.body.password === process.env.ADMIN_PASSWORD) {
    req.session.auth = true;
    return res.redirect('/dashboard');
  }
  res.redirect('/login?error=Неверный логин или пароль');
});

function requireAuth(req, res, next) {
  if (req.session.auth) return next();
  res.redirect('/login');
}

// API endpoint для получения статистики (публичный)
app.get('/api/stats', (req, res) => {
  // Получаем статистику за всё время
  const totalStats = {
    orders: db.prepare('SELECT COUNT(*) as c FROM orders').get().c,
    openChats: db.prepare('SELECT COUNT(*) as c FROM orders WHERE support_status = ?').get('open').c,
    keys: db.prepare('SELECT COUNT(*) as c FROM key_pool WHERE is_used = 0').get().c,
    totalRevenue: db.prepare(`
      SELECT COALESCE(SUM(p.price), 0) as total 
      FROM orders o
      JOIN products p ON o.product_id = p.id
      WHERE o.status = 'paid'
    `).get().total,
    userCount: db.prepare('SELECT COUNT(*) as c FROM users').get().c
  };

  // Получаем статистику за сегодня
  const today = new Date().toISOString().split('T')[0];
  const todayStats = {
    orders: db.prepare('SELECT COUNT(*) as c FROM orders WHERE DATE(created_at) = ?').get(today).c,
    revenue: db.prepare(`
      SELECT COALESCE(SUM(p.price), 0) as total 
      FROM orders o
      JOIN products p ON o.product_id = p.id
      WHERE o.status = 'paid' AND DATE(o.created_at) = ?
    `).get(today).total
  };

  // Получаем статистику за месяц
  const monthAgo = new Date();
  monthAgo.setMonth(monthAgo.getMonth() - 1);
  const monthAgoStr = monthAgo.toISOString().split('T')[0];
  const monthStats = {
    orders: db.prepare('SELECT COUNT(*) as c FROM orders WHERE DATE(created_at) >= ?').get(monthAgoStr).c,
    revenue: db.prepare(`
      SELECT COALESCE(SUM(p.price), 0) as total 
      FROM orders o
      JOIN products p ON o.product_id = p.id
      WHERE o.status = 'paid' AND DATE(o.created_at) >= ?
    `).get(monthAgoStr).total
  };

  // Рассчитываем процент успешных заказов
  const allOrders = db.prepare('SELECT COUNT(*) as c FROM orders').get().c;
  const paidOrders = db.prepare('SELECT COUNT(*) as c FROM orders WHERE status = ?').get('paid').c;
  const successRate = allOrders > 0 ? Math.round((paidOrders / allOrders) * 100) : 0;

  res.json({
    totalOrders: totalStats.orders,
    totalRevenue: totalStats.totalRevenue,
    todayRevenue: todayStats.revenue,
    monthRevenue: monthStats.revenue,
    activeUsers: totalStats.userCount,
    availableKeys: totalStats.keys,
    openChats: totalStats.openChats,
    successRate: successRate
  });
});

// API endpoint для получения статистики (для админки)
app.get('/api/admin-stats', requireAuth, (req, res) => {
  // Получаем статистику за всё время
  const totalStats = {
    orders: db.prepare('SELECT COUNT(*) as c FROM orders').get().c,
    openChats: db.prepare('SELECT COUNT(*) as c FROM orders WHERE support_status = ?').get('open').c,
    keys: db.prepare('SELECT COUNT(*) as c FROM key_pool WHERE is_used = 0').get().c,
    totalRevenue: db.prepare(`
      SELECT COALESCE(SUM(p.price), 0) as total 
      FROM orders o
      JOIN products p ON o.product_id = p.id
      WHERE o.status = 'paid'
    `).get().total,
    userCount: db.prepare('SELECT COUNT(*) as c FROM users').get().c
  };

  // Получаем статистику за сегодня
  const today = new Date().toISOString().split('T')[0];
  const todayStats = {
    orders: db.prepare('SELECT COUNT(*) as c FROM orders WHERE DATE(created_at) = ?').get(today).c,
    revenue: db.prepare(`
      SELECT COALESCE(SUM(p.price), 0) as total 
      FROM orders o
      JOIN products p ON o.product_id = p.id
      WHERE o.status = 'paid' AND DATE(o.created_at) = ?
    `).get(today).total
  };

  // Получаем статистику за месяц
  const monthAgo = new Date();
  monthAgo.setMonth(monthAgo.getMonth() - 1);
  const monthAgoStr = monthAgo.toISOString().split('T')[0];
  const monthStats = {
    orders: db.prepare('SELECT COUNT(*) as c FROM orders WHERE DATE(created_at) >= ?').get(monthAgoStr).c,
    revenue: db.prepare(`
      SELECT COALESCE(SUM(p.price), 0) as total 
      FROM orders o
      JOIN products p ON o.product_id = p.id
      WHERE o.status = 'paid' AND DATE(o.created_at) >= ?
    `).get(monthAgoStr).total
  };

  res.json({
    total: totalStats,
    today: todayStats,
    month: monthStats
  });
});

// API endpoint для получения продуктов
app.get('/api/products', (req, res) => {
  const products = models.getActiveProducts();
  res.json(products);
});

// API endpoint для отправки тикета в поддержку
app.post('/api/ticket', express.json(), async (req, res) => {
  try {
    const { name, email, message } = req.body;
    
    // Проверяем обязательные поля
    if (!name || !email || !message) {
      return res.status(400).json({ error: 'Все поля обязательны для заполнения' });
    }
    
    // Отправляем сообщение в Telegram администратору
    await bot.telegram.sendMessage(
      process.env.ADMIN_TG_ID,
      `🎫 Новый тикет в поддержку!\n\nИмя: ${name}\nEmail: ${email}\n\nСообщение: ${message}`
    );
    
    res.json({ success: true });
  } catch (error) {
    console.error('Ошибка отправки тикета:', error);
    res.status(500).json({ error: 'Ошибка отправки тикета' });
  }
});

app.get('/dashboard', requireAuth, (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Дашборд - Wayfis</title>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
      <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css" rel="stylesheet">
      <style>
        .stat-card { border-left: 4px solid #007bff; }
        .sidebar { min-height: 100vh; }
        .main-content { padding: 2rem 0; }
        .stat-period { background-color: #f8f9fa; padding: 1rem; border-radius: 0.5rem; margin-bottom: 1rem; }
        #statsChart { height: 300px; }
      </style>
    </head>
    <body>
      <div class="container-fluid">
        <div class="row">
          <!-- Sidebar -->
          <nav class="col-md-3 col-lg-2 d-md-block sidebar collapse">
            <div class="position-sticky pt-3">
              <ul class="nav flex-column">
                <li class="nav-item">
                  <a class="nav-link active" href="/dashboard">
                    <i class="fas fa-tachometer-alt"></i> Дашборд
                  </a>
                </li>
                <li class="nav-item">
                  <a class="nav-link" href="/keys">
                    <i class="fas fa-key"></i> Ключи
                  </a>
                </li>
                <li class="nav-item">
                  <a class="nav-link" href="/support">
                    <i class="fas fa-headset"></i> Поддержка
                  </a>
                </li>
                <li class="nav-item">
                  <a class="nav-link" href="/logout">
                    <i class="fas fa-sign-out-alt"></i> Выйти
                  </a>
                </li>
              </ul>
            </div>
          </nav>

          <!-- Main Content -->
          <main class="col-md-9 ms-sm-auto col-lg-10 px-md-4">
            <div class="d-flex justify-content-between flex-wrap flex-md-nowrap align-items-center pt-3 pb-2 mb-3 border-bottom">
              <h1 class="h2">📊 Панель управления</h1>
            </div>

            <div class="row mb-4">
              <div class="col-xl-3 col-md-6 mb-4">
                <div class="stat-period">
                  <h5>Сегодня</h5>
                  <p>Заказов: <strong id="todayOrders">0</strong></p>
                  <p>Доход: <strong id="todayRevenue">0</strong> ₽</p>
                </div>
              </div>
              <div class="col-xl-3 col-md-6 mb-4">
                <div class="stat-period">
                  <h5>Месяц</h5>
                  <p>Заказов: <strong id="monthOrders">0</strong></p>
                  <p>Доход: <strong id="monthRevenue">0</strong> ₽</p>
                </div>
              </div>
              <div class="col-xl-3 col-md-6 mb-4">
                <div class="stat-period">
                  <h5>Всё время</h5>
                  <p>Заказов: <strong id="totalOrders">0</strong></p>
                  <p>Доход: <strong id="totalRevenue">0</strong> ₽</p>
                </div>
              </div>
              <div class="col-xl-3 col-md-6 mb-4">
                <div class="stat-period">
                  <h5>Прочее</h5>
                  <p>Пользователей: <strong id="userCount">0</strong></p>
                  <p>Открытых чатов: <strong id="openChats">0</strong></p>
                  <p>Свободных ключей: <strong id="freeKeys">0</strong></p>
                </div>
              </div>
            </div>

            <div class="row">
              <div class="col-xl-4 col-md-6 mb-4">
                <div class="card stat-card border-left-primary shadow h-100 py-2">
                  <div class="card-body">
                    <div class="row no-gutters align-items-center">
                      <div class="col mr-2">
                        <div class="text-xs font-weight-bold text-primary text-uppercase mb-1">
                          Заказов всего</div>
                        <div class="h5 mb-0 font-weight-bold text-gray-800" id="totalOrdersCard">0</div>
                      </div>
                      <div class="col-auto">
                        <i class="fas fa-shopping-cart fa-2x text-gray-300"></i>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div class="col-xl-4 col-md-6 mb-4">
                <div class="card stat-card border-left-success shadow h-100 py-2">
                  <div class="card-body">
                    <div class="row no-gutters align-items-center">
                      <div class="col mr-2">
                        <div class="text-xs font-weight-bold text-success text-uppercase mb-1">
                          Пользователей</div>
                        <div class="h5 mb-0 font-weight-bold text-gray-800" id="userCountCard">0</div>
                      </div>
                      <div class="col-auto">
                        <i class="fas fa-users fa-2x text-gray-300"></i>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div class="col-xl-4 col-md-6 mb-4">
                <div class="card stat-card border-left-info shadow h-100 py-2">
                  <div class="card-body">
                    <div class="row no-gutters align-items-center">
                      <div class="col mr-2">
                        <div class="text-xs font-weight-bold text-info text-uppercase mb-1">
                          Свободных ключей</div>
                        <div class="h5 mb-0 font-weight-bold text-gray-800" id="freeKeysCard">0</div>
                      </div>
                      <div class="col-auto">
                        <i class="fas fa-key fa-2x text-gray-300"></i>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div class="row">
              <div class="col-12">
                <div class="card shadow mb-4">
                  <div class="card-header py-3">
                    <h6 class="m-0 font-weight-bold text-primary">📊 График доходов</h6>
                  </div>
                  <div class="card-body">
                    <canvas id="revenueChart"></canvas>
                  </div>
                </div>
              </div>
            </div>

            <div class="row">
              <div class="col-12">
                <div class="card shadow mb-4">
                  <div class="card-header py-3">
                    <h6 class="m-0 font-weight-bold text-primary">Информация</h6>
                  </div>
                  <div class="card-body">
                    <p>Добро пожаловать в панель управления Wayfis!</p>
                    <ul>
                      <li>📊 Статистика по заказам, доходам и чатам поддержки</li>
                      <li>📈 Доход за сутки, месяц и всё время</li>
                      <li>🔐 Безопасный доступ с аутентификацией</li>
                      <li>💬 Управление чатами поддержки клиентов</li>
                      <li>🔑 Управление ключами для продуктов</li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          </main>
        </div>
      </div>

      <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
      <script>
        async function loadStats() {
          try {
            const response = await fetch('/api/admin-stats');
            const data = await response.json();
            
            // Обновляем статистику
            document.getElementById('todayOrders').textContent = data.today.orders;
            document.getElementById('todayRevenue').textContent = data.today.revenue;
            document.getElementById('monthOrders').textContent = data.month.orders;
            document.getElementById('monthRevenue').textContent = data.month.revenue;
            document.getElementById('totalOrders').textContent = data.total.orders;
            document.getElementById('totalRevenue').textContent = data.total.totalRevenue;
            document.getElementById('userCount').textContent = data.total.userCount;
            document.getElementById('openChats').textContent = data.total.openChats;
            document.getElementById('freeKeys').textContent = data.total.keys;
            
            document.getElementById('totalOrdersCard').textContent = data.total.orders;
            document.getElementById('userCountCard').textContent = data.total.userCount;
            document.getElementById('freeKeysCard').textContent = data.total.keys;
            
            // Создаем график
            const ctx = document.getElementById('revenueChart').getContext('2d');
            new Chart(ctx, {
              type: 'line',
              data: {
                labels: ['Сегодня', 'За 7 дней', 'За 30 дней', 'Всё время'],
                datasets: [{
                  label: 'Доход (₽)',
                  data: [data.today.revenue, data.week ? data.week.revenue : 0, data.month.revenue, data.total.totalRevenue],
                  backgroundColor: 'rgba(54, 162, 235, 0.2)',
                  borderColor: 'rgba(54, 162, 235, 1)',
                  borderWidth: 2,
                  fill: true
                }]
              },
              options: {
                responsive: true,
                scales: {
                  y: {
                    beginAtZero: true
                  }
                }
              }
            });
          } catch (error) {
            console.error('Ошибка загрузки статистики:', error);
          }
        }
        
        // Загружаем статистику при загрузке страницы
        document.addEventListener('DOMContentLoaded', loadStats);
      </script>
    </body>
    </html>
  `);
});

app.get('/keys', requireAuth, (req, res) => {
  const keys = db.prepare(`
    SELECT k.*, p.name as product_name
    FROM key_pool k
    JOIN products p ON k.product_id = p.id
    ORDER BY k.id DESC
  `).all();
  const products = models.getActiveProducts();
  
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Ключи - Wayfis</title>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
      <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css" rel="stylesheet">
      <style>
        .sidebar { min-height: 100vh; }
        .key-status { padding: 0.25rem 0.5rem; border-radius: 0.25rem; font-size: 0.875rem; }
        .status-used { background-color: #f8d7da; color: #721c24; }
        .status-free { background-color: #d4edda; color: #155724; }
      </style>
    </head>
    <body>
      <div class="container-fluid">
        <div class="row">
          <!-- Sidebar -->
          <nav class="col-md-3 col-lg-2 d-md-block sidebar collapse">
            <div class="position-sticky pt-3">
              <ul class="nav flex-column">
                <li class="nav-item">
                  <a class="nav-link" href="/dashboard">
                    <i class="fas fa-tachometer-alt"></i> Дашборд
                  </a>
                </li>
                <li class="nav-item">
                  <a class="nav-link active" href="/keys">
                    <i class="fas fa-key"></i> Ключи
                  </a>
                </li>
                <li class="nav-item">
                  <a class="nav-link" href="/support">
                    <i class="fas fa-headset"></i> Поддержка
                  </a>
                </li>
                <li class="nav-item">
                  <a class="nav-link" href="/logout">
                    <i class="fas fa-sign-out-alt"></i> Выйти
                  </a>
                </li>
              </ul>
            </div>
          </nav>

          <!-- Main Content -->
          <main class="col-md-9 ms-sm-auto col-lg-10 px-md-4">
            <div class="d-flex justify-content-between flex-wrap flex-md-nowrap align-items-center pt-3 pb-2 mb-3 border-bottom">
              <h1 class="h2">🔑 Управление ключами</h1>
            </div>

            <div class="row mb-4">
              <div class="col-12">
                <div class="card shadow">
                  <div class="card-header">
                    <h5 class="mb-0">Добавить ключ</h5>
                  </div>
                  <div class="card-body">
                    <form method="POST" action="/keys">
                      <div class="row">
                        <div class="col-md-6">
                          <label class="form-label">Продукт</label>
                          <select name="product_id" class="form-select" required>
                            ${products.map(p => `<option value="${p.id}">${p.name}</option>`).join('')}
                          </select>
                        </div>
                        <div class="col-md-6">
                          <label class="form-label">Ключ</label>
                          <input type="text" name="key_value" class="form-control" placeholder="Введите ключ" required>
                        </div>
                      </div>
                      <div class="mt-3">
                        <button type="submit" class="btn btn-primary">Добавить ключ</button>
                      </div>
                    </form>
                  </div>
                </div>
              </div>
            </div>

            <div class="row">
              <div class="col-12">
                <div class="card shadow">
                  <div class="card-header">
                    <h5 class="mb-0">Список ключей</h5>
                  </div>
                  <div class="card-body">
                    <div class="table-responsive">
                      <table class="table table-striped">
                        <thead>
                          <tr>
                            <th>ID</th>
                            <th>Ключ</th>
                            <th>Продукт</th>
                            <th>Статус</th>
                            <th>Дата создания</th>
                          </tr>
                        </thead>
                        <tbody>
                          ${keys.map(k => `
                            <tr>
                              <td>${k.id}</td>
                              <td><code>${k.key_value}</code></td>
                              <td>${k.product_name}</td>
                              <td>
                                <span class="key-status ${k.is_used ? 'status-used' : 'status-free'}">
                                  ${k.is_used ? 'Использован' : 'Свободен'}
                                </span>
                              </td>
                              <td>${new Date(k.created_at).toLocaleString()}</td>
                            </tr>
                          `).join('')}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </main>
        </div>
      </div>
    </body>
    </html>
  `);
});

app.post('/keys', requireAuth, (req, res) => {
  models.addKey(req.body.product_id, req.body.key_value);
  res.redirect('/keys');
});

// ЧАТЫ ПОДДЕРЖКИ
app.get('/support', requireAuth, (req, res) => {
  const chats = db.prepare(`
    SELECT o.*, p.name as product_name
    FROM orders o
    JOIN products p ON o.product_id = p.id
    WHERE o.support_status = 'open'
    ORDER BY o.created_at DESC
  `).all();
  
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Поддержка - Wayfis</title>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
      <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css" rel="stylesheet">
      <style>
        .sidebar { min-height: 100vh; }
        .chat-status { padding: 0.25rem 0.5rem; border-radius: 0.25rem; font-size: 0.875rem; }
        .status-open { background-color: #d4edda; color: #155724; }
        .status-closed { background-color: #f8d7da; color: #721c24; }
      </style>
    </head>
    <body>
      <div class="container-fluid">
        <div class="row">
          <!-- Sidebar -->
          <nav class="col-md-3 col-lg-2 d-md-block sidebar collapse">
            <div class="position-sticky pt-3">
              <ul class="nav flex-column">
                <li class="nav-item">
                  <a class="nav-link" href="/dashboard">
                    <i class="fas fa-tachometer-alt"></i> Дашборд
                  </a>
                </li>
                <li class="nav-item">
                  <a class="nav-link" href="/keys">
                    <i class="fas fa-key"></i> Ключи
                  </a>
                </li>
                <li class="nav-item">
                  <a class="nav-link active" href="/support">
                    <i class="fas fa-headset"></i> Поддержка
                  </a>
                </li>
                <li class="nav-item">
                  <a class="nav-link" href="/logout">
                    <i class="fas fa-sign-out-alt"></i> Выйти
                  </a>
                </li>
              </ul>
            </div>
          </nav>

          <!-- Main Content -->
          <main class="col-md-9 ms-sm-auto col-lg-10 px-md-4">
            <div class="d-flex justify-content-between flex-wrap flex-md-nowrap align-items-center pt-3 pb-2 mb-3 border-bottom">
              <h1 class="h2">💬 Чаты поддержки</h1>
            </div>

            <div class="row">
              <div class="col-12">
                <div class="card shadow">
                  <div class="card-body">
                    <div class="table-responsive">
                      <table class="table table-striped">
                        <thead>
                          <tr>
                            <th>ID заказа</th>
                            <th>Продукт</th>
                            <th>Telegram ID</th>
                            <th>Дата создания</th>
                            <th>Статус</th>
                            <th>Действия</th>
                          </tr>
                        </thead>
                        <tbody>
                          ${chats.map(chat => `
                            <tr>
                              <td>${chat.id}</td>
                              <td>${chat.product_name}</td>
                              <td>${chat.user_id}</td>
                              <td>${new Date(chat.created_at).toLocaleString()}</td>
                              <td>
                                <span class="chat-status status-open">
                                  Открыт
                                </span>
                              </td>
                              <td>
                                <a href="/chat/${chat.id}" class="btn btn-sm btn-primary">
                                  <i class="fas fa-comments"></i> Перейти
                                </a>
                              </td>
                            </tr>
                          `).join('')}
                        </tbody>
                      </table>
                      ${chats.length === 0 ? '<p class="text-muted">Нет открытых чатов поддержки</p>' : ''}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </main>
        </div>
      </div>
    </body>
    </html>
  `);
});

app.get('/chat/:orderId', requireAuth, (req, res) => {
  const orderId = req.params.orderId;
  const chat = db.prepare(`
    SELECT o.*, p.name as product_name
    FROM orders o
    JOIN products p ON o.product_id = p.id
    WHERE o.id = ? AND o.support_status = 'open'
  `).get(orderId);

  if (!chat) return res.redirect('/support');

  const messages = models.getChatHistory(orderId);
  
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Чат #${orderId} - Wayfis</title>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
      <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css" rel="stylesheet">
      <style>
        .sidebar { min-height: 100vh; }
        .chat-container { height: 600px; overflow-y: auto; }
        .message { padding: 10px; margin: 5px 0; border-radius: 8px; max-width: 70%; }
        .message-user { background-color: #e3f2fd; margin-left: auto; }
        .message-admin { background-color: #f5f5f5; margin-right: auto; }
        .message-time { font-size: 0.75rem; color: #6c757d; display: block; margin-top: 5px; }
      </style>
    </head>
    <body>
      <div class="container-fluid">
        <div class="row">
          <!-- Sidebar -->
          <nav class="col-md-3 col-lg-2 d-md-block sidebar collapse">
            <div class="position-sticky pt-3">
              <ul class="nav flex-column">
                <li class="nav-item">
                  <a class="nav-link" href="/dashboard">
                    <i class="fas fa-tachometer-alt"></i> Дашборд
                  </a>
                </li>
                <li class="nav-item">
                  <a class="nav-link" href="/keys">
                    <i class="fas fa-key"></i> Ключи
                  </a>
                </li>
                <li class="nav-item">
                  <a class="nav-link active" href="/support">
                    <i class="fas fa-headset"></i> Поддержка
                  </a>
                </li>
                <li class="nav-item">
                  <a class="nav-link" href="/logout">
                    <i class="fas fa-sign-out-alt"></i> Выйти
                  </a>
                </li>
              </ul>
            </div>
          </nav>

          <!-- Main Content -->
          <main class="col-md-9 ms-sm-auto col-lg-10 px-md-4">
            <div class="d-flex justify-content-between flex-wrap flex-md-nowrap align-items-center pt-3 pb-2 mb-3 border-bottom">
              <h1 class="h2">💬 Чат #${orderId}</h1>
              <div>
                <span class="badge bg-primary me-2">Заказ: ${chat.id}</span>
                <span class="badge bg-info me-2">Продукт: ${chat.product_name}</span>
                <span class="badge bg-success">Telegram: ${chat.user_id}</span>
              </div>
            </div>

            <div class="row">
              <div class="col-12">
                <div class="card shadow">
                  <div class="card-body">
                    <div id="chat-container" class="chat-container p-3 mb-3 border rounded">
                      ${messages.map(msg => `
                        <div class="message ${msg.sender === 'user' ? 'message-user' : 'message-admin'}">
                          <strong>${msg.sender === 'user' ? 'Пользователь' : 'Администратор'}:</strong>
                          <div>${msg.text}</div>
                          <span class="message-time">${new Date(msg.timestamp).toLocaleTimeString()}</span>
                        </div>
                      `).join('')}
                    </div>
                    
                    <form method="POST" action="/chat/${orderId}/send" class="row">
                      <div class="col-md-9">
                        <input type="text" name="message" class="form-control" placeholder="Введите сообщение..." required>
                      </div>
                      <div class="col-md-3">
                        <button type="submit" class="btn btn-primary w-100">Отправить</button>
                      </div>
                    </form>
                    
                    <div class="mt-3">
                      <form method="POST" action="/chat/${orderId}/close" style="display: inline;">
                        <button type="submit" class="btn btn-danger" onclick="return confirm('Закрыть чат?')">
                          <i class="fas fa-times"></i> Закрыть чат
                        </button>
                      </form>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </main>
        </div>
        
        <script>
          // Автоматически прокручиваем чат вниз
          const chatContainer = document.getElementById('chat-container');
          chatContainer.scrollTop = chatContainer.scrollHeight;
        </script>
      </div>
    </body>
    </html>
  `);
});

app.post('/chat/:orderId/send', requireAuth, async (req, res) => {
  const orderId = req.params.orderId;
  const { message } = req.body;

  if (!message.trim()) return res.redirect(`/chat/${orderId}`);

  try {
    models.saveMessage(orderId, 'admin', message);

    const order = models.getOrderById(orderId);
    if (order) {
      await bot.telegram.sendMessage(order.user_id, `👨‍💼 Поддержка:\n${message}`);
    }

    // Отправляем событие в админку
    const io = app.locals.io;
    io.to(`chat-${orderId}`).emit('new-message', {
      sender: 'admin',
      text: message,
      time: new Date().toLocaleTimeString()
    });

    res.redirect(`/chat/${orderId}`);
  } catch (err) {
    console.error('Ошибка отправки:', err);
    res.redirect(`/chat/${orderId}`);
  }
});

app.post('/chat/:orderId/close', requireAuth, (req, res) => {
  models.closeSupportChat(req.params.orderId);
  res.redirect('/support');
});

app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

// API для получения статистики сайта
app.get('/api/stats', (req, res) => {
  // Получаем статистику за всё время
  const totalStats = {
    orders: db.prepare('SELECT COUNT(*) as c FROM orders').get().c,
    openChats: db.prepare('SELECT COUNT(*) as c FROM orders WHERE support_status = ?').get('open').c,
    keys: db.prepare('SELECT COUNT(*) as c FROM key_pool WHERE is_used = 0').get().c,
    totalRevenue: db.prepare(`
      SELECT COALESCE(SUM(p.price), 0) as total 
      FROM orders o
      JOIN products p ON o.product_id = p.id
      WHERE o.status = 'paid'
    `).get().total
  };

  // Получаем статистику за сегодня
  const today = new Date().toISOString().split('T')[0];
  const todayStats = {
    orders: db.prepare('SELECT COUNT(*) as c FROM orders WHERE DATE(created_at) = ?').get(today).c,
    revenue: db.prepare(`
      SELECT COALESCE(SUM(p.price), 0) as total 
      FROM orders o
      JOIN products p ON o.product_id = p.id
      WHERE o.status = 'paid' AND DATE(o.created_at) = ?
    `).get(today).total
  };

  // Получаем статистику за месяц
  const monthAgo = new Date();
  monthAgo.setMonth(monthAgo.getMonth() - 1);
  const monthAgoStr = monthAgo.toISOString().split('T')[0];
  const monthStats = {
    orders: db.prepare('SELECT COUNT(*) as c FROM orders WHERE DATE(created_at) >= ?').get(monthAgoStr).c,
    revenue: db.prepare(`
      SELECT COALESCE(SUM(p.price), 0) as total 
      FROM orders o
      JOIN products p ON o.product_id = p.id
      WHERE o.status = 'paid' AND DATE(o.created_at) >= ?
    `).get(monthAgoStr).total
  };

  // Получаем количество активных пользователей
  const activeUsers = db.prepare(`
    SELECT COUNT(DISTINCT user_id) as c 
    FROM orders 
    WHERE created_at >= date('now', '-30 days')
  `).get().c;

  // Рассчитываем процент успешных заказов
  const totalOrders = db.prepare('SELECT COUNT(*) as c FROM orders').get().c;
  const paidOrders = db.prepare('SELECT COUNT(*) as c FROM orders WHERE status = ?').get('paid').c;
  const successRate = totalOrders > 0 ? Math.round((paidOrders / totalOrders) * 100) : 0;

  res.json({
    totalOrders: totalStats.orders,
    totalRevenue: totalStats.totalRevenue,
    todayRevenue: todayStats.revenue,
    monthRevenue: monthStats.revenue,
    activeUsers: activeUsers,
    availableKeys: totalStats.keys,
    openChats: totalStats.openChats,
    successRate: successRate
  });
});

// API для получения списка продуктов
app.get('/api/products', (req, res) => {
  const products = db.prepare(`
    SELECT p.*, 
           COUNT(k.id) as available_keys 
    FROM products p
    LEFT JOIN key_pool k ON p.id = k.product_id AND k.is_used = 0
    WHERE p.is_enabled = 1
    GROUP BY p.id
  `).all();
  
  res.json(products);
});

// API для создания тикета из веб-сайта
app.post('/api/ticket', express.json(), (req, res) => {
  const { name, email, message } = req.body;
  
  if (!name || !email || !message) {
    return res.status(400).json({ error: 'Все поля обязательны для заполнения' });
  }
  
  // Здесь можно добавить сохранение тикета в базу данных
  // Пока просто отправляем уведомление в Telegram
  
  const bot = app.locals.bot;
  if (bot) {
    bot.telegram.sendMessage(
      process.env.ADMIN_TG_ID, 
      `🆘 Новый тикет с сайта!\n\nИмя: ${name}\nEmail: ${email}\nСообщение: ${message}`
    ).catch(err => {
      console.error('Ошибка отправки тикета в Telegram:', err);
    });
  }
  
  res.json({ success: true, message: 'Ваш тикет отправлен в поддержку. Администратор свяжется с вами в ближайшее время.' });
});

// Запуск
bot.launch({ dropPendingUpdates: true }).catch(err => {
  console.log('⚠️ Бот не запущен (неправильный токен или тестовый режим)');
  console.log('Ошибка бота:', err.message);
});

server.listen(3000, () => {
  console.log('🚀 Админка: http://localhost:3000');
  console.log('🤖 Бот запущен (или будет запущен при корректных данных)');
});