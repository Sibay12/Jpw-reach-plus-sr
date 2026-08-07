const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const https = require('https');
const TelegramBot = require('node-telegram-bot-api');

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
    { amount: 20, coins: 1 }, { amount: 50, coins: 3 }, { amount: 100, coins: 7 },
    { amount: 200, coins: 15 }, { amount: 400, coins: 33 }, { amount: 800, coins: 70 }, { amount: 1000, coins: 99 }
];

let otpStorage = {}, srSessions = {}, webOrderSessions = {}, serverPublicUrl = '';

mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 10000 })
    .then(async () => {
        console.log('🟢 MongoDB Connected');
        try {
            await mongoose.connection.collection('users').updateMany(
                { reaches: { $exists: true } },
                [{ $set: { coins: { $add: ["$coins", "$reaches"] } } }, { $unset: "reaches" }]
            );
        } catch(e) {}
    })
    .catch(err => console.log('❌ DB Error:', err.message));

const UserModel = mongoose.model('User', new mongoose.Schema({ telegramChatId: String, name: String, coins: { type: Number, default: 0 } }));
const OrderModel = mongoose.model('Order', new mongoose.Schema({ telegramChatId: String, serviceType: String, targetId: String, srMobile: String, srLandline: String, srCustomerName: String, status: { type: String, default: 'Pending' }, createdAt: { type: Date, default: Date.now } }));

// --- BOT LOGIC ---
const bot = new TelegramBot(CUSTOMER_BOT_TOKEN, { polling: true });
bot.on('message', async (msg) => {
    const chatId = String(msg.chat.id);
    if (chatId === ADMIN_CHAT_ID) return;
    const text = msg.text?.trim();

    if (text === '/start') {
        let user = await UserModel.findOne({ telegramChatId: chatId }) || await UserModel.create({ telegramChatId: chatId, name: msg.from.first_name });
        bot.sendMessage(chatId, `✨ Welcome! Your Coins: ${user.coins.toFixed(4)}`, {
            reply_markup: { inline_keyboard: [[{text: "🛠️ Submit SR", callback_data: "sr"}, {text: "🌐 Web Order", callback_data: "web"}], [{text: "🚀 Portal", web_app: {url: "https://jpw-portal.onrender.com"}}]] }
        });
    }
});

bot.on('callback_query', (query) => {
    const chatId = String(query.message.chat.id);
    if(query.data === 'sr') { srSessions[chatId] = { step: 'mobile' }; bot.sendMessage(chatId, "Enter Mobile:"); }
    else if(query.data === 'web') { webOrderSessions[chatId] = { step: 'targetId' }; bot.sendMessage(chatId, "Enter ID:"); }
});

// --- API ROUTES ---
app.get('/api/user-history', async (req, res) => {
    const orders = await OrderModel.find({ telegramChatId: req.query.telegramChatId }).sort({ createdAt: -1 });
    res.json({ success: true, orders });
});

app.post('/api/admin/modify-coins', async (req, res) => {
    const { userId, amount, type } = req.body;
    let user = await UserModel.findById(userId);
    if (type === 'add') user.coins += parseFloat(amount);
    else user.coins = Math.max(0, user.coins - parseFloat(amount));
    await user.save();
    res.json({ success: true });
});

// --- SERVER START ---
app.listen(PORT, () => { console.log(`🚀 Server running on port ${PORT}`); });
