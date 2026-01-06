require('dotenv').config();
const express = require('express');
const session = require('express-session');
const http = require('http');
const { Server } = require('socket.io');
const { Telegraf, Markup } = require('telegraf');
const path = require('path');
const helmet = require('helmet');
const expressLayouts = require('express-ejs-layouts');

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
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(expressLayouts);

// Middleware to make req available in views
app.use((req, res, next) => {
  res.locals.req = req;
  next();
});

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
bot.start((ctx) => {
  const products = models.getActiveProducts();
  if (products.length === 0) return ctx.reply('🛒 Товары скоро появятся!');

  const buttons = products.map(p =>
    Markup.button.callback(`${p.name} — ${p.price} ₽`, `buy_${p.id}`)
  );
  ctx.reply('🔑 Выберите лицензию:', Markup.inlineKeyboard(buttons));
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

// Middleware to make req available in views
app.use((req, res, next) => {
  res.locals.req = req;
  next();
});

// ======= ВЕБ-АДМИНКА =======
app.get('/', (req, res) => {
  res.redirect('/login');
});

app.get('/login', (req, res) => res.render('login'));
app.post('/login', (req, res) => {
  if (req.body.username === process.env.ADMIN_LOGIN &&
      req.body.password === process.env.ADMIN_PASSWORD) {
    req.session.auth = true;
    return res.redirect('/dashboard');
  }
  res.render('login', { error: 'Неверный логин или пароль' });
});

function requireAuth(req, res, next) {
  if (req.session.auth) return next();
  res.redirect('/login');
}

app.get('/dashboard', requireAuth, (req, res) => {
  const stats = {
    orders: db.prepare('SELECT COUNT(*) as c FROM orders').get().c,
    openChats: db.prepare('SELECT COUNT(*) as c FROM orders WHERE support_status = ?').get('open').c,
    keys: db.prepare('SELECT COUNT(*) as c FROM key_pool WHERE is_used = 0').get().c
  };
  res.render('dashboard', { stats });
});

app.get('/keys', requireAuth, (req, res) => {
  const keys = db.prepare(`
    SELECT k.*, p.name as product_name
    FROM key_pool k
    JOIN products p ON k.product_id = p.id
    ORDER BY k.id DESC
  `).all();
  const products = models.getActiveProducts();
  res.render('keys', { keys, products });
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
  res.render('support', { chats });
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
  res.render('chat', { chat, messages, orderId });
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

// Запуск
bot.launch({ dropPendingUpdates: true }).catch(err => {
  console.log('⚠️ Бот не запущен (неправильный токен или тестовый режим)');
  console.log('Ошибка бота:', err.message);
});

server.listen(3000, () => {
  console.log('🚀 Админка: http://localhost:3000');
  console.log('🤖 Бот запущен (или будет запущен при корректных данных)');
});