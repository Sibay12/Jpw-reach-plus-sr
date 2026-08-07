const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const https = require('https');
const TelegramBot = require('node-telegram-bot-api');
const { debugLog, getRecentLogs } = require('./utils/logger');
const adsModule = require('./adsModule');

process.on('uncaughtException', (err) => { debugLog('CrashGuard', 'Uncaught Exception:', err.message); });
process.on('unhandledRejection', (reason) => { debugLog('CrashGuard', 'Unhandled Rejection:', reason); });

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
const CASHFREE_CLIENT_SECRET = 'cfsk_ma_prod_07c2ec902fhab79b31d72c924423b03a_edc81cf8';
const CASHFREE_ENV = 'PRODUCTION';

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
let adminPendingBroadcast = false;
let adminPendingGiveaway = false;
let transferSessions = {};
let primaryCustomerBotUsername = 'jpw_reach_bot';
let serverPublicUrl = '';

mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 10000 })
    .then(async () => {
        debugLog('Database', '🟢 MongoDB Connected Successfully!');
        try { await mongoose.connection.collection('users').dropIndexes().catch(() => {}); } catch(e) {}
        initAllBots();
        startBackgroundGreetingTimer();
        startOrderCleanupTimer();
    })
    .catch(err => debugLog('Database', '❌ DB Error:', err.message));

const userSchema = new mongoose.Schema({
    telegramChatId: { type: String, required: true, unique: true },
    name: { type: String, default: 'User' },
    coins: { type: Number, default: 0 },
    activePackage: { type: String, default: 'No active package' },
    lastBonusTime: { type: Date, default: null },
    referredBy: { type: String, default: null },
    hasRecharged100: { type: Boolean, default: false },
    referralRewarded: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now }
});

const orderSchema = new mongoose.Schema({
    telegramChatId: String,
    serviceType: { type: String, default: 'Website' },
    targetId: String,
    targetPass: String,
    srMobile: { type: String, default: '' },
    srLandline: { type: String, default: '' },
    srCustomerName: { type: String, default: '' },
    status: { type: String, default: 'Pending' },
    adminReply: { type: String, default: '' },
    createdAt: { type: Date, default: Date.now }
});

const usedUtrSchema = new mongoose.Schema({ utrId: { type: String, required: true, unique: true } });

const UserModel = mongoose.model('User', userSchema);
const OrderModel = mongoose.model('Order', orderSchema);
const UsedUtrModel = mongoose.model('UsedUtr', usedUtrSchema);

function initAllBots() {
    startCustomerBot(CUSTOMER_BOT_TOKEN);
    startAdminBot(ADMIN_BOT_TOKEN);
    debugLog('Bots', '🤖 All bots initialized successfully.');
}

function startOrderCleanupTimer() {
    setInterval(async () => {
        try {
            const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
            await OrderModel.deleteMany({
                createdAt: { $lt: twoHoursAgo },
                status: { $in: ['Completed', 'Rejected', 'Cancelled & Refunded'] }
            });
        } catch (err) {}
    }, 60 * 60 * 1000);
}

// 🕒 Time-to-Time Background Greeting Timer Restored
function startBackgroundGreetingTimer() {
    const INTERVAL_TIME = 20 * 60 * 1000;
    setInterval(async () => {
        try {
            const utcDate = new Date();
            const istTime = new Date(utcDate.getTime() + (330 * 60 * 1000));
            const hours = istTime.getUTCHours();
            const minutes = istTime.getUTCMinutes();
            const currentTimeInMinutes = hours * 60 + minutes;

            const startTime = 7 * 60 + 30; // 7:30 AM IST
            const endTime = 22 * 60;       // 10:00 PM IST

            if (currentTimeInMinutes < startTime || currentTimeInMinutes > endTime) return;

            const allUsers = await UserModel.find({});
            if (allUsers.length === 0) return;

            let timeGreeting = "Hello";
            if (hours >= 4 && hours < 12) timeGreeting = "Good Morning";
            else if (hours >= 12 && hours < 17) timeGreeting = "Good Afternoon";
            else if (hours >= 17 && hours < 21) timeGreeting = "Good Evening";

            for (let user of allUsers) {
                if (!user.telegramChatId) continue;
                const userName = user.name || 'Friend';
                const comfortMessage = `🌟 **${timeGreeting}, ${userName}!** 🌿\n\nEverything is running smoothly here. You don't need to worry about anything. Stay relaxed! 😌\n\nHave your meal peacefully, we are managing everything. Have a great time! ☕✨\n\n*(JPW COIN SERVICES BOT)*`;

                if (CUSTOMER_BOT_TOKEN) {
                    const tempBot = new TelegramBot(CUSTOMER_BOT_TOKEN, { polling: false });
                    await tempBot.sendMessage(user.telegramChatId, comfortMessage, { parse_mode: 'Markdown' }).catch(() => {});
                }
            }
        } catch (err) {}
    }, INTERVAL_TIME);
}

async function notifyAdminDirect(messageText) {
    try {
        if (ADMIN_BOT_TOKEN) {
            const tempBot = new TelegramBot(ADMIN_BOT_TOKEN, { polling: false });
            await tempBot.sendMessage(ADMIN_CHAT_ID, messageText, { parse_mode: 'Markdown' });
        }
    } catch (e) {}
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
                    let displayTarget = order.serviceType === 'SR' ? `SR Mobile: ${order.srMobile}` : `Target ID: ${order.targetId}`;
                    await notifyCustomerOnly(order, await UserModel.findOne({ telegramChatId: order.telegramChatId }), `💬 **Admin message regarding your order**\n🎯 ${displayTarget}\n\n📢 *${text}*`);
                    bot.sendMessage(chatId, `✅ Reply sent successfully!`);
                } else {
                    bot.sendMessage(chatId, `❌ Order not found!`);
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
                let targetIdentifier = order.serviceType === 'SR' ? order.srMobile : order.targetId;
                bot.sendMessage(chatId, `✍️ **Send reply for Order / SR:** \`${targetIdentifier}\``, { parse_mode: 'Markdown' });
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
            await notifyCustomerOnly(order, user, `📢 **Order Status Update:** ${order.status}`);
        });
    } catch(e) {}
}

function startCustomerBot(token) {
    try {
        const bot = new TelegramBot(token, { polling: true });
        bot.on('polling_error', () => {});
        bot.getMe().then(info => { primaryCustomerBotUsername = info.username; }).catch(() => {});

        bot.on('message', async (msg) => {
            if (!msg || !msg.chat || !msg.text) return;
            const chatId = String(msg.chat.id);
            if (chatId === ADMIN_CHAT_ID) return;

            const text = msg.text.trim();
            const activeBotUsername = primaryCustomerBotUsername || 'jpw_reach_bot';

            if (text.startsWith('/start')) {
                const payload = text.split(' ')[1];
                let referrerId = null;
                if (payload && payload.startsWith('ref_')) {
                    referrerId = payload.replace('ref_', '').trim();
                }

                let user = await UserModel.findOne({ telegramChatId: chatId });
                if (!user) {
                    user = await UserModel.create({ 
                        telegramChatId: chatId, 
                        name: msg.from.first_name || 'User', 
                        coins: 0,
                        referredBy: (referrerId && referrerId !== chatId) ? referrerId : null
                    });
                    await notifyAdminDirect(`👤 **New User Registered**\n💬 Chat ID: \`${chatId}\``);
                }
                
                const portalUrl = serverPublicUrl || "https://jpw-portal.onrender.com";
                const referralLink = `https://t.me/${activeBotUsername}?start=ref_${chatId}`;
                const welcomeMsg = `✨ **Welcome to JPW COIN SERVICES BOT!** 🚀\n\n🆔 **Chat ID:** \`${chatId}\`\n🔗 **Portal Link:**\n${portalUrl}\n\n👥 **Referral Link:**\n\`${referralLink}\`\n\n🪙 **JPW Coins:** ${user.coins.toFixed(4)}`;
                const keyboard = {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: "🚀 Open Mini App Portal", web_app: { url: portalUrl } }],
                            [{ text: "🎁 Daily Bonus", callback_data: "claim_daily_bonus" }, { text: "🎬 Watch Ad", callback_data: "watch_ad_task" }],
                            [{ text: "🤝 Share Coins", callback_data: "start_reach_transfer" }, { text: "👥 Refer & Earn", callback_data: "show_referral_info" }],
                            [{ text: "🪙 Check Balance", callback_data: "check_balance" }, { text: "📦 Packages", callback_data: "view_packages" }]
                        ]
                    }
                };
                await bot.sendMessage(chatId, welcomeMsg, { parse_mode: 'Markdown', ...keyboard });
                return;
            }

            if (transferSessions[chatId]) {
                const session = transferSessions[chatId];
                if (session.step === 'awaiting_receiver') {
                    session.receiverId = text;
                    session.step = 'awaiting_amount';
                    bot.sendMessage(chatId, `✍️ How many JPW Coins do you want to send?`);
                    return;
                } else if (session.step === 'awaiting_amount') {
                    const amount = parseFloat(text);
                    const receiverId = session.receiverId;
                    delete transferSessions[chatId];

                    let sender = await UserModel.findOne({ telegramChatId: chatId });
                    let receiver = await UserModel.findOne({ telegramChatId: receiverId });
                    if (sender && receiver && sender.coins >= amount && amount > 0) {
                        sender.coins -= amount;
                        receiver.coins += amount;
                        await sender.save();
                        await receiver.save();
                        bot.sendMessage(chatId, `✅ Successfully transferred ${amount} coins!`);
                    } else {
                        bot.sendMessage(chatId, `❌ Transfer failed! Check balance or ID.`);
                    }
                    return;
                }
            }

            const parts = text.split(' ');
            if (parts.length >= 2 && parts[0].length >= 8) {
                const targetId = parts[0];
                const targetPass = parts.slice(1).join(' ');

                let user = await UserModel.findOne({ telegramChatId: chatId });
                if (!user || user.coins < 1) {
                    bot.sendMessage(chatId, `❌ **Insufficient Balance!** At least 1 JPW Coin required.`);
                    return;
                }

                user.coins -= 1;
                await user.save();

                const newOrder = await OrderModel.create({ telegramChatId: chatId, serviceType: 'Website', targetId, targetPass });
                await notifyAdminAndUser(newOrder, user, `🌐 **New Website Order**\n🎯 ID: \`${targetId}\``);
                bot.sendMessage(chatId, `📦 **Order Submitted!** 🚀\n🪙 Remaining Coins: *${user.coins.toFixed(4)}*`);
                return;
            }
        });

        bot.on('callback_query', async (query) => {
            const chatId = String(query.message.chat.id);
            const data = query.data;
            let user = await UserModel.findOne({ telegramChatId: chatId });
            const activeBotUsername = primaryCustomerBotUsername || 'jpw_reach_bot';

            if (data === 'show_referral_info') {
                const portalUrl = serverPublicUrl || "https://jpw-portal.onrender.com";
                const referralLink = `https://t.me/${activeBotUsername}?start=ref_${chatId}`;
                bot.answerCallbackQuery(query.id, { text: 'Refer info' });
                bot.sendMessage(chatId, `👥 **Referral Link:**\n\`${referralLink}\``, { parse_mode: 'Markdown' });
            } else if (data === 'start_reach_transfer') {
                transferSessions[chatId] = { step: 'awaiting_receiver' };
                bot.answerCallbackQuery(query.id, { text: 'Transfer started' });
                bot.sendMessage(chatId, `🤝 Enter Receiver's **Telegram Chat ID**:`);
            } else if (data === 'watch_ad_task') {
                bot.answerCallbackQuery(query.id, { text: '⏳ Coming soon!', show_alert: true });
            } else if (data === 'claim_daily_bonus') {
                const now = new Date();
                if (user && user.lastBonusTime) {
                    const diffTime = now - new Date(user.lastBonusTime);
                    const hoursLeft = 24 - (diffTime / (1000 * 60 * 60));
                    if (hoursLeft > 0) {
                        bot.answerCallbackQuery(query.id, { text: `⏳ Wait ${hoursLeft.toFixed(1)} hours!`, show_alert: true });
                        return;
                    }
                }
                if (user) {
                    const randomBonus = parseFloat((Math.random() * (0.001 - 0.0001) + 0.0001).toFixed(6));
                    user.coins += randomBonus;
                    user.lastBonusTime = now;
                    await user.save();
                    bot.answerCallbackQuery(query.id, { text: `🎉 +${randomBonus} Claimed!`, show_alert: true });
                }
            } else if (data === 'check_balance') {
                bot.answerCallbackQuery(query.id, { text: `Balance: ${user ? user.coins.toFixed(4) : 0} Coins` });
            } else if (data === 'view_packages') {
                let inlineRows = [];
                RECHARGE_PACKAGES.forEach(p => {
                    inlineRows.push([{ text: `💳 Buy ₹${p.amount} ➡️ ${p.coins} Coins`, callback_data: `buy_${p.amount}` }]);
                });
                bot.sendMessage(chatId, `📦 **Select Package:**`, { reply_markup: { inline_keyboard: inlineRows } });
            }
        });
    } catch (e) {}
}

async function notifyCustomerOnly(order, user, messageText) {
    try {
        if (user && user.telegramChatId && CUSTOMER_BOT_TOKEN) {
            const tempCustBot = new TelegramBot(CUSTOMER_BOT_TOKEN, { polling: false });
            await tempCustBot.sendMessage(user.telegramChatId, messageText, { parse_mode: 'Markdown' });
        }
    } catch (e) {}
}

async function notifyAdminAndUser(order, user, messageText) {
    try {
        let adminKeyboard = {
            reply_markup: {
                inline_keyboard: [
                    [{ text: "✅ Accept", callback_data: `accept_${order._id}` }, { text: "❌ Reject", callback_data: `reject_${order._id}` }],
                    [{ text: "⏳ In Progress", callback_data: `inprogress_${order._id}` }, { text: "🎉 Complete", callback_data: `complete_${order._id}` }],
                    [{ text: "💬 Reply", callback_data: `reply_${order._id}` }]
                ]
            }
        };
        if (ADMIN_BOT_TOKEN) {
            const tempBot = new TelegramBot(ADMIN_BOT_TOKEN, { polling: false });
            await tempBot.sendMessage(ADMIN_CHAT_ID, messageText, { parse_mode: 'Markdown', ...adminKeyboard });
        }
    } catch (e) {}
}

app.get('/api/bot-info', (req, res) => { res.json({ success: true, botUsername: primaryCustomerBotUsername }); });
app.get('/api/packages', (req, res) => { res.json({ success: true, packages: RECHARGE_PACKAGES }); });

// 🔐 OTP Login APIs Restored
app.post('/api/send-otp', async (req, res) => {
    let { telegramChatId } = req.body;
    telegramChatId = String(telegramChatId).trim();
    let user = await UserModel.findOne({ telegramChatId });
    if (!user) return res.json({ success: false, message: 'User not registered!' });
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    otpStorage[telegramChatId] = { otp, expires: Date.now() + 5*60*1000 };
    const tempBot = new TelegramBot(CUSTOMER_BOT_TOKEN, { polling: false });
    await tempBot.sendMessage(telegramChatId, `🔐 **Portal Login OTP:** \`${otp}\``, { parse_mode: 'Markdown' });
    res.json({ success: true, message: 'OTP sent successfully!' });
});

app.post('/api/verify-otp', async (req, res) => {
    let { telegramChatId, otp } = req.body;
    telegramChatId = String(telegramChatId).trim();
    const record = otpStorage[telegramChatId];
    if (!record || record.expires < Date.now() || record.otp !== String(otp).trim()) {
        return res.json({ success: false, message: 'Invalid or expired OTP!' });
    }
    delete otpStorage[telegramChatId];
    let user = await UserModel.findOne({ telegramChatId });
    res.json({ success: true, user });
});

app.post('/api/mini-app/auth', async (req, res) => {
    let { telegramChatId, name } = req.body;
    if (!telegramChatId) return res.json({ success: false, message: 'Unauthorized' });
    let user = await UserModel.findOne({ telegramChatId: String(telegramChatId) });
    if (!user) {
        user = await UserModel.create({ telegramChatId: String(telegramChatId), name: name || 'User', coins: 0 });
    }
    res.json({ success: true, user });
});

app.post('/api/admin/login', (req, res) => {
    if (req.body.password === ADMIN_SECRET_PASS) res.json({ success: true });
    else res.json({ success: false, message: 'Incorrect password!' });
});

app.post('/api/admin/change-password', (req, res) => {
    const { oldPassword, newPassword } = req.body;
    if (oldPassword !== ADMIN_SECRET_PASS) return res.json({ success: false, message: 'Incorrect old password!' });
    ADMIN_SECRET_PASS = newPassword.trim();
    res.json({ success: true, message: 'Updated!' });
});

app.get('/api/admin/logs', (req, res) => { res.json({ success: true, logs: getRecentLogs() }); });

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
                        res.json({ success: false, message: json.message || 'Failed' });
                    }
                } catch(e) { res.status(500).json({ success: false }); }
            });
        });
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

app.post('/cashfree-webhook', async (req, res) => {
    try {
        res.status(200).send('OK');
        const eventData = req.body;
        if (eventData?.data?.order && eventData?.data?.payment?.payment_status === 'SUCCESS') {
            const orderId = eventData.data.order.order_id;
            const paymentId = String(eventData.data.payment.cf_payment_id);
            const orderAmount = eventData.data.order.order_amount;
            const parts = orderId.split('_');
            if (parts.length >= 3) {
                const telegramChatId = parts[2];
                let coinsToAdd = 1;
                RECHARGE_PACKAGES.forEach(pkg => { if (pkg.amount === Number(orderAmount)) coinsToAdd = pkg.coins; });

                const existingUtr = await UsedUtrModel.findOne({ utrId: paymentId });
                if (!existingUtr) {
                    await UsedUtrModel.create({ utrId: paymentId });
                    let user = await UserModel.findOne({ telegramChatId });
                    if (user) {
                        user.coins += coinsToAdd;
                        await user.save();
                        await notifyCustomerOnly(null, user, `💳 **Payment Successful!** +${coinsToAdd} JPW Coins added.`);
                    }
                }
            }
        }
    } catch (err) {}
});

app.post('/api/order', async (req, res) => {
    try {
        const { telegramChatId, targetId, targetPass } = req.body;
        let user = await UserModel.findOne({ telegramChatId: String(telegramChatId) });
        if (!user || user.coins < 1) return res.json({ success: false, message: 'Insufficient balance!' });

        user.coins -= 1;
        await user.save();

        const newOrder = await OrderModel.create({ telegramChatId: String(telegramChatId), serviceType: 'Website', targetId, targetPass });
        await notifyAdminAndUser(newOrder, user, `🌐 **New Website Order**\n🎯 ID: \`${targetId}\``);
        res.json({ success: true, message: 'Order submitted!', remainingCoins: user.coins });
    } catch (err) { res.status(500).json({ success: false }); }
});

app.post('/api/sr-order', async (req, res) => {
    try {
        const { telegramChatId, srMobile, srLandline, srCustomerName } = req.body;
        let user = await UserModel.findOne({ telegramChatId: String(telegramChatId) });
        if (!user || user.coins < 1) return res.json({ success: false, message: 'Insufficient balance!' });

        user.coins -= 1;
        await user.save();

        const newOrder = await OrderModel.create({ telegramChatId: String(telegramChatId), serviceType: 'SR', srMobile, srLandline, srCustomerName, targetId: srMobile });
        await notifyAdminAndUser(newOrder, user, `🛠️ **New SR Service Request**\n📱 Mobile: \`${srMobile}\`\n📞 Landline: \`${srLandline}\`\n👤 Customer: \`${srCustomerName}\``);
        res.json({ success: true, message: 'SR Service submitted!', remainingCoins: user.coins });
    } catch (err) { res.status(500).json({ success: false }); }
});

app.get('/api/admin/data', async (req, res) => {
    const orders = await OrderModel.find().sort({ createdAt: -1 });
    const users = await UserModel.find();
    res.json({ success: true, orders, users });
});

app.post('/api/admin/order-action', async (req, res) => {
    const { orderId, action } = req.body;
    let order = await OrderModel.findById(orderId);
    if (!order) return res.json({ success: false });
    let user = await UserModel.findOne({ telegramChatId: order.telegramChatId });
    if (action === 'accept') order.status = 'Accepted';
    else if (action === 'reject') { order.status = 'Rejected'; if (user) { user.coins += 1; await user.save(); } }
    else if (action === 'inprogress') order.status = 'In Progress';
    else if (action === 'complete') order.status = 'Completed';
    await order.save();
    await notifyAdminAndUser(order, user, `📢 **Status Update:** ${order.status}`);
    res.json({ success: true });
});

app.get('/admin', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'admin.html')); });
app.get('*', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'index.html')); });

const SELF_URL = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
setInterval(() => {
    https.get(SELF_URL, (res) => {}).on('error', (err) => {});
}, 10 * 60 * 1000);

app.listen(PORT, '0.0.0.0', () => {
    serverPublicUrl = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
    debugLog('Server', `🚀 Live on port ${PORT}`);
});
