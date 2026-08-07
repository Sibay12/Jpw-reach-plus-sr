const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const https = require('https');
const TelegramBot = require('node-telegram-bot-api');
const { debugLog, getRecentLogs } = require('./utils/logger');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
const MONGO_URI = 'mongodb+srv://sibadityapal47_db_user:G95Dds7IGyBQNmGh@cluster0.yjvazin.mongodb.net/jpw_bot?retryWrites=true&w=majority';

let ADMIN_SECRET_PASS = 'jpwadmin123';
const ADMIN_CHAT_ID = '7659178694';

const CASHFREE_CLIENT_ID = '132151420cc80e33a29ab5a896e4151231';
const CASHFREE_CLIENT_SECRET = 'cfsk_ma_prod_07c2ec902f0ab79b31d72c924423b03a_edc81cf8';

const CUSTOMER_BOT_TOKEN = '8437403049:AAGpJJ4dZZ5it5duK-hcvJE5Xu8rxu8J2XY';
const ADMIN_BOT_TOKEN = '8945258673:AAG_-nLAQLbv5-LGxfk2wPW5mMfbKD-PN0w';

const RECHARGE_PACKAGES = [
    { amount: 20, coins: 1 },
    { amount: 50, coins: 3 },
    { amount: 100, coins: 7 },
    { amount: 200, coins: 15 },
    { amount: 400, coins: 33 },
    { amount: 800, coins: 70 },
    { amount: 1000, coins: 99 }
];

let otpStorage = {};
let adminPendingReply = {};
let transferSessions = {};
let srSessions = {};
let webOrderSessions = {};
let serverPublicUrl = '';

mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 10000 })
    .then(async () => {
        debugLog('Database', '🟢 Connected!');
        try {
            await mongoose.connection.collection('users').updateMany(
                { reaches: { $exists: true } },
                [{ $set: { coins: { $add: ["$coins", "$reaches"] } } }, { $unset: "reaches" }]
            );
        } catch(e) {}
        initAllBots();
    })
    .catch(err => debugLog('Database', '❌ Error:', err.message));

const userSchema = new mongoose.Schema({
    telegramChatId: { type: String, required: true, unique: true },
    name: { type: String, default: 'User' },
    coins: { type: Number, default: 0 },
    lastBonusTime: { type: Date, default: null }
});

const orderSchema = new mongoose.Schema({
    telegramChatId: String,
    serviceType: String,
    targetId: String,
    targetPass: String,
    srMobile: String,
    srLandline: String,
    srCustomerName: String,
    status: { type: String, default: 'Pending' },
    adminReply: String,
    createdAt: { type: Date, default: Date.now }
});

const usedUtrSchema = new mongoose.Schema({ utrId: { type: String, required: true, unique: true } });

const UserModel = mongoose.model('User', userSchema);
const OrderModel = mongoose.model('Order', orderSchema);
const UsedUtrModel = mongoose.model('UsedUtr', usedUtrSchema);

function initAllBots() {
    startCustomerBot(CUSTOMER_BOT_TOKEN);
    startAdminBot(ADMIN_BOT_TOKEN);
    debugLog('Bots', '🤖 Bots initialized.');
}

function startAdminBot(token) {
    try {
        const bot = new TelegramBot(token, { polling: true });
        bot.on('polling_error', () => {});
        bot.on('message', async (msg) => {
            if (!msg || !msg.chat || !msg.text) return;
            const chatId = String(msg.chat.id);
            if (chatId !== ADMIN_CHAT_ID) return;
            const text = msg.text.trim();

            if (text.startsWith('/start')) {
                bot.sendMessage(chatId, `👑 **Admin Panel Active**`, { parse_mode: 'Markdown' });
                return;
            }

            if (adminPendingReply[chatId]) {
                const orderId = adminPendingReply[chatId];
                delete adminPendingReply[chatId];
                let order = await OrderModel.findById(orderId);
                if (order) {
                    order.adminReply = text;
                    await order.save();
                    let user = await UserModel.findOne({ telegramChatId: order.telegramChatId });
                    if (user && user.telegramChatId) {
                        const tempCustBot = new TelegramBot(CUSTOMER_BOT_TOKEN, { polling: false });
                        await tempCustBot.sendMessage(user.telegramChatId, `💬 **Admin Reply:**\n${text}`);
                    }
                    bot.sendMessage(chatId, `✅ Reply sent!`);
                }
                return;
            }
        });

        bot.on('callback_query', async (query) => {
            const chatId = String(query.message.chat.id);
            if (chatId !== ADMIN_CHAT_ID) return;
            const data = query.data;
            const [action, orderId] = data.split('_');

            let order = await OrderModel.findById(orderId);
            if (!order) return bot.answerCallbackQuery(query.id, { text: 'Not found!' });

            let user = await UserModel.findOne({ telegramChatId: order.telegramChatId });

            if (action === 'reply') {
                adminPendingReply[chatId] = orderId;
                bot.answerCallbackQuery(query.id, { text: 'Send reply...' });
                bot.sendMessage(chatId, `✍️ Send reply message:`);
                return;
            } else if (action === 'accept') {
                order.status = 'Accepted';
            } else if (action === 'reject') {
                order.status = 'Rejected';
                if (user) { user.coins += 1; await user.save(); }
            } else if (action === 'inprogress') {
                order.status = 'In Progress';
            } else if (action === 'complete') {
                order.status = 'Completed';
            }

            await order.save();
            bot.answerCallbackQuery(query.id, { text: 'Updated!' });
            if (user && user.telegramChatId) {
                const tempCustBot = new TelegramBot(CUSTOMER_BOT_TOKEN, { polling: false });
                await tempCustBot.sendMessage(user.telegramChatId, `📢 **Order Status Update:** ${order.status}`);
            }
        });
    } catch(e) {}
}

function startCustomerBot(token) {
    try {
        const bot = new TelegramBot(token, { polling: true });
        bot.on('polling_error', () => {});
        bot.on('message', async (msg) => {
            if (!msg || !msg.chat || !msg.text) return;
            const chatId = String(msg.chat.id);
            if (chatId === ADMIN_CHAT_ID) return;
            const text = msg.text.trim();

            let user = await UserModel.findOne({ telegramChatId: chatId });
            if (!user) {
                user = await UserModel.create({ telegramChatId: chatId, name: msg.from.first_name || 'User', coins: 0 });
            }

            // Handle SR Service Conversational Flow via Bot
            if (srSessions[chatId]) {
                const session = srSessions[chatId];
                if (session.step === 'mobile') {
                    session.mobile = text;
                    session.step = 'landline';
                    bot.sendMessage(chatId, `📞 Please enter the **Customer Landline Number**:`);
                    return;
                } else if (session.step === 'landline') {
                    session.landline = text;
                    session.step = 'name';
                    bot.sendMessage(chatId, `👤 Please enter the **Customer Name**:`);
                    return;
                } else if (session.step === 'name') {
                    session.name = text;
                    delete srSessions[chatId];

                    if (user.coins < 1) {
                        bot.sendMessage(chatId, `❌ **Insufficient Balance!** You need at least 1 JPW Coin.`);
                        return;
                    }

                    user.coins -= 1;
                    await user.save();

                    const newOrder = await OrderModel.create({
                        telegramChatId: chatId,
                        serviceType: 'SR',
                        srMobile: session.mobile,
                        srLandline: session.landline,
                        srCustomerName: session.name,
                        targetId: session.mobile
                    });

                    if (ADMIN_BOT_TOKEN) {
                        const tempBot = new TelegramBot(ADMIN_BOT_TOKEN, { polling: false });
                        let adminKeyboard = {
                            reply_markup: {
                                inline_keyboard: [
                                    [{ text: "✅ Accept", callback_data: `accept_${newOrder._id}` }, { text: "❌ Reject", callback_data: `reject_${newOrder._id}` }],
                                    [{ text: "⏳ In Progress", callback_data: `inprogress_${newOrder._id}` }, { text: "🎉 Complete", callback_data: `complete_${newOrder._id}` }],
                                    [{ text: "💬 Reply", callback_data: `reply_${newOrder._id}` }]
                                ]
                            }
                        };
                        await tempBot.sendMessage(ADMIN_CHAT_ID, `🛠️ **New SR Service Request**\n📱 Mobile: \`${session.mobile}\`\n📞 Landline: \`${session.landline}\`\n👤 Customer: \`${session.name}\``, { parse_mode: 'Markdown', ...adminKeyboard });
                    }

                    bot.sendMessage(chatId, `✅ **SR Service Submitted Successfully!** 🚀\n🪙 Remaining Coins: *${user.coins.toFixed(4)}*`);
                    return;
                }
            }

            // Handle Website Order Conversational Flow via Bot
            if (webOrderSessions[chatId]) {
                const session = webOrderSessions[chatId];
                if (session.step === 'targetId') {
                    session.targetId = text;
                    session.step = 'targetPass';
                    bot.sendMessage(chatId, `🔑 Please enter the **Target Password**:`);
                    return;
                } else if (session.step === 'targetPass') {
                    const targetPass = text;
                    const targetId = session.targetId;
                    delete webOrderSessions[chatId];

                    if (user.coins < 1) {
                        bot.sendMessage(chatId, `❌ **Insufficient Balance!** You need at least 1 JPW Coin.`);
                        return;
                    }

                    user.coins -= 1;
                    await user.save();

                    const newOrder = await OrderModel.create({
                        telegramChatId: chatId,
                        serviceType: 'Website',
                        targetId: targetId,
                        targetPass: targetPass
                    });

                    if (ADMIN_BOT_TOKEN) {
                        const tempBot = new TelegramBot(ADMIN_BOT_TOKEN, { polling: false });
                        let adminKeyboard = {
                            reply_markup: {
                                inline_keyboard: [
                                    [{ text: "✅ Accept", callback_data: `accept_${newOrder._id}` }, { text: "❌ Reject", callback_data: `reject_${newOrder._id}` }],
                                    [{ text: "⏳ In Progress", callback_data: `inprogress_${newOrder._id}` }, { text: "🎉 Complete", callback_data: `complete_${newOrder._id}` }],
                                    [{ text: "💬 Reply", callback_data: `reply_${newOrder._id}` }]
                                ]
                            }
                        };
                        await tempBot.sendMessage(ADMIN_CHAT_ID, `🌐 **New Website Order**\n🎯 ID: \`${targetId}\``, { parse_mode: 'Markdown', ...adminKeyboard });
                    }

                    bot.sendMessage(chatId, `✅ **Website Order Submitted!** 🚀\n🪙 Remaining Coins: *${user.coins.toFixed(4)}*`);
                    return;
                }
            }

            if (text.startsWith('/start')) {
                const portalUrl = serverPublicUrl || "https://jpw-portal.onrender.com";
                const welcomeMsg = `✨ **Welcome to JPW COIN SERVICES BOT!** 🚀\n\n🆔 **Chat ID:** \`${chatId}\`\n🪙 **JPW Coins:** ${user.coins.toFixed(4)}\n\n👇 **Choose an option below:**`;
                const keyboard = {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: "🛠️ Submit SR Service", callback_data: "start_sr_service" }, { text: "🌐 Website Order", callback_data: "start_web_order" }],
                            [{ text: "🚀 Open Mini App Portal", web_app: { url: portalUrl } }],
                            [{ text: "🪙 Check Balance", callback_data: "check_balance" }, { text: "📦 Packages", callback_data: "view_packages" }]
                        ]
                    }
                };
                await bot.sendMessage(chatId, welcomeMsg, { parse_mode: 'Markdown', ...keyboard });
                return;
            }
        });

        bot.on('callback_query', async (query) => {
            const chatId = String(query.message.chat.id);
            const data = query.data;
            let user = await UserModel.findOne({ telegramChatId: chatId });

            if (data === 'start_sr_service') {
                srSessions[chatId] = { step: 'mobile' };
                bot.answerCallbackQuery(query.id, { text: 'SR Service Started' });
                bot.sendMessage(chatId, `🛠️ **SR Service Request**\nPlease enter the **Customer Registered Mobile Number**:`, { parse_mode: 'Markdown' });
            } else if (data === 'start_web_order') {
                webOrderSessions[chatId] = { step: 'targetId' };
                bot.answerCallbackQuery(query.id, { text: 'Website Order Started' });
                bot.sendMessage(chatId, `🌐 **Website Order**\nPlease enter the **Target Username / ID**:`, { parse_mode: 'Markdown' });
            } else if (data === 'check_balance') {
                bot.answerCallbackQuery(query.id, { text: `Balance: ${user ? user.coins.toFixed(4) : 0} Coins` });
            } else if (data === 'view_packages') {
                let inlineRows = [];
                RECHARGE_PACKAGES.forEach(p => {
                    inlineRows.push([{ text: `💳 Buy ₹${p.amount} ➡️ ${p.coins} Coins`, callback_data: `buy_${p.amount}` }]);
                });
                bot.sendMessage(chatId, `📦 **Select Package:**`, { reply_markup: { inline_keyboard: inlineRows } });
            } else if (data.startsWith('buy_')) {
                const amount = data.replace('buy_', '');
                const portalUrl = serverPublicUrl || "https://jpw-portal.onrender.com";
                bot.sendMessage(chatId, `💳 To purchase the ₹${amount} package, please open the Mini App Portal below:`, {
                    reply_markup: {
                        inline_keyboard: [[{ text: "🚀 Open Portal to Pay", web_app: { url: portalUrl } }]]
                    }
                });
            }
        });
    } catch(e) {}
}

// --- ADMIN API ENDPOINTS ---

app.post('/api/admin/login', (req, res) => {
    if (req.body.password === ADMIN_SECRET_PASS) res.json({ success: true });
    else res.json({ success: false, message: 'Incorrect password!' });
});

app.post('/api/admin/change-password', (req, res) => {
    const { oldPassword, newPassword } = req.body;
    if (oldPassword !== ADMIN_SECRET_PASS) return res.json({ success: false, message: 'Incorrect old password!' });
    ADMIN_SECRET_PASS = newPassword.trim();
    res.json({ success: true, message: 'Password updated!' });
});

app.get('/api/admin/data', async (req, res) => {
    const orders = await OrderModel.find().sort({ createdAt: -1 });
    const users = await UserModel.find();
    res.json({ success: true, orders, users });
});

app.post('/api/admin/modify-coins', async (req, res) => {
    const { userId, amount, type } = req.body;
    let user = await UserModel.findById(userId);
    if (!user) return res.json({ success: false, message: 'User not found!' });
    if (type === 'add') user.coins += parseFloat(amount);
    else if (type === 'sub') user.coins = Math.max(0, user.coins - parseFloat(amount));
    await user.save();
    res.json({ success: true, user });
});

app.post('/api/admin/delete-user', async (req, res) => {
    const { userId } = req.body;
    await UserModel.findByIdAndDelete(userId);
    res.json({ success: true });
});

app.post('/api/admin/order-action', async (req, res) => {
    const { orderId, action } = req.body;
    let order = await OrderModel.findById(orderId);
    if (!order) return res.json({ success: false });
    
    let user = await UserModel.findOne({ telegramChatId: order.telegramChatId });
    if (action === 'reject' && user) { user.coins += 1; await user.save(); }
    
    order.status = action === 'accept' ? 'Accepted' : (action === 'reject' ? 'Rejected' : (action === 'inprogress' ? 'In Progress' : 'Completed'));
    await order.save();
    res.json({ success: true });
});

// --- OTP & AUTH APIS ---

app.post('/api/send-otp', async (req, res) => {
    let { telegramChatId } = req.body;
    telegramChatId = String(telegramChatId).trim();
    let user = await UserModel.findOne({ telegramChatId });
    if (!user) return res.json({ success: false, message: 'User not registered!' });
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    otpStorage[telegramChatId] = { otp, expires: Date.now() + 5*60*1000 };
    const tempBot = new TelegramBot(CUSTOMER_BOT_TOKEN, { polling: false });
    await tempBot.sendMessage(telegramChatId, `🔐 **Portal Login OTP:** \`${otp}\``, { parse_mode: 'Markdown' });
    res.json({ success: true });
});

app.post('/api/verify-otp', async (req, res) => {
    let { telegramChatId, otp } = req.body;
    telegramChatId = String(telegramChatId).trim();
    const record = otpStorage[telegramChatId];
    if (!record || record.expires < Date.now() || record.otp !== String(otp).trim()) {
        return res.json({ success: false, message: 'Invalid OTP!' });
    }
    delete otpStorage[telegramChatId];
    let user = await UserModel.findOne({ telegramChatId });
    res.json({ success: true, user });
});

app.post('/api/mini-app/auth', async (req, res) => {
    let { telegramChatId, name } = req.body;
    if (!telegramChatId) return res.json({ success: false });
    let user = await UserModel.findOne({ telegramChatId: String(telegramChatId) });
    if (!user) {
        user = await UserModel.create({ telegramChatId: String(telegramChatId), name: name || 'User', coins: 0 });
    }
    res.json({ success: true, user });
});

app.get('/api/packages', (req, res) => { res.json({ success: true, packages: RECHARGE_PACKAGES }); });

// --- CASHFREE PAYMENT API ---

app.post('/api/pay', async (req, res) => {
    try {
        const { telegramChatId, amount, coins } = req.body;
        const protocol = req.headers['x-forwarded-proto'] || req.protocol;
        const serverUrl = `${protocol}://${req.get('host')}`;
        let orderId = `JPW_${Date.now()}_${telegramChatId}`;

        const postData = JSON.stringify({
            order_id: orderId,
            order_amount: parseFloat(amount),
            order_currency: "INR",
            customer_details: { customer_id: String(telegramChatId), customer_phone: "9999999999", customer_email: "test@jpw.com" },
            order_meta: { return_url: `${serverUrl}/?payment=success&telegramChatId=${telegramChatId}&coins=${coins}&order_id=${orderId}` }
        });

        const options = {
            hostname: 'api.cashfree.com',
            path: '/pg/orders',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-client-id': CASHFREE_CLIENT_ID,
                'x-client-secret': CASHFREE_CLIENT_SECRET,
                'x-api-version': '2022-09-01'
            }
        };

        const reqCashfree = https.request(options, (response) => {
            let body = '';
            response.on('data', chunk => body += chunk);
            response.on('end', () => {
                try {
                    const json = JSON.parse(body);
                    if (response.statusCode === 200 && json.payment_session_id) {
                        res.json({ success: true, paymentSessionId: json.payment_session_id, orderId, environment: 'PRODUCTION' });
                    } else {
                        res.json({ success: false, message: json.message || 'Authorization Failed' });
                    }
                } catch(e) { res.status(500).json({ success: false, message: 'JSON Parse Error' }); }
            });
        });
        reqCashfree.on('error', () => { res.status(500).json({ success: false, message: 'Network Error' }); });
        reqCashfree.write(postData);
        reqCashfree.end();
    } catch (err) { res.status(500).json({ success: false }); }
});

app.post('/api/verify-instant', async (req, res) => {
    try {
        const { telegramChatId, coins, order_id } = req.body;
        const transactionId = order_id || `INSTANT_${Date.now()}_${telegramChatId}`;
        const existingUtr = await UsedUtrModel.findOne({ utrId: transactionId });
        if (existingUtr) return res.json({ success: false, message: 'Already credited!' });

        let user = await UserModel.findOne({ telegramChatId: String(telegramChatId) });
        if (user) {
            await UsedUtrModel.create({ utrId: transactionId });
            user.coins += parseFloat(coins);
            await user.save();
            res.json({ success: true, user });
        } else { res.json({ success: false }); }
    } catch (err) { res.status(500).json({ success: false }); }
});

app.get('/admin', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'admin.html')); });
app.get('*', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'index.html')); });

// --- KEEP ALIVE ---
const SELF_URL = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
setInterval(() => { https.get(SELF_URL, (res) => {}).on('error', (err) => {}); }, 10 * 60 * 1000);

app.listen(PORT, '0.0.0.0', () => { debugLog('Server', '🚀 Live'); });
