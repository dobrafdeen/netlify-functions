const { Telegraf, Markup } = require('telegraf');

// إعدادات البوت
const BOT_TOKEN = "7465262401:AAGN-vBzFsBSWe8vqy_YNlrvVfHNa7vPkHM";
const ADMIN_ID = 6873334348;
const CHANNEL_ID = -1002530096487;

// تخزين الاشتراكات في الذاكرة
const users = {};

// دالة لحساب الوقت (بالثواني)
function daysToMs(days) {
  return days * 24 * 60 * 60 * 1000;
}

function sendAdminRequest(ctx, user) {
  ctx.telegram.sendMessage(
    ADMIN_ID,
    `طلب جديد للاشتراك من:\nاسم: ${user.first_name}\nيوزر: @${user.username || "بدون"}\nID: ${user.id}`,
    Markup.inlineKeyboard([
      Markup.button.callback(`قبول ${user.id}`, `accept_${user.id}`),
      Markup.button.callback(`رفض ${user.id}`, `reject_${user.id}`)
    ])
  );
}

function sendRenewRequest(ctx, userId) {
  ctx.telegram.sendMessage(
    ADMIN_ID,
    `طلب تجديد اشتراك من المستخدم ID: ${userId}`,
    Markup.inlineKeyboard([
      Markup.button.callback(`تجديد ${userId}`, `renew_${userId}`),
      Markup.button.callback(`رفض طلب التجديد ${userId}`, `denyrenew_${userId}`)
    ])
  );
}

// دالة لطرد المستخدم من القناة
async function kickFromChannel(bot, userId) {
  try {
    await bot.telegram.kickChatMember(CHANNEL_ID, userId);
  } catch (e) { /* تجاهل الأخطاء */ }
}

// دالة لإرسال إشعار للمستخدم
function notifyUser(bot, userId, text) {
  bot.telegram.sendMessage(userId, text).catch(() => {});
}

// إعداد البوت
const bot = new Telegraf(BOT_TOKEN, { telegram: { webhookReply: true } });

bot.start((ctx) => {
  users[ctx.from.id] = users[ctx.from.id] || { status: "pending", data: ctx.from };
  ctx.reply(
    "مرحباً بك في بوت الاشتراك في القناة.\nيرجى الضغط على زر الاشتراك ليتم إرسال طلبك للمشرف.",
    Markup.inlineKeyboard([
      [Markup.button.callback("طلب اشتراك", "subscribe")]
    ])
  );
});

bot.action("subscribe", (ctx) => {
  const user = ctx.from;
  if (users[user.id]?.status === "active") {
    ctx.answerCbQuery("أنت مشترك بالفعل.");
    return;
  }
  users[user.id] = { status: "requested", data: user };
  sendAdminRequest(ctx, user);
  ctx.answerCbQuery("تم إرسال طلبك للمشرف. انتظر الموافقة.");
});

// قبول الاشتراك من المشرف
bot.action(/accept_(\d+)/, async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return ctx.answerCbQuery();
  const userId = parseInt(ctx.match[1]);
  if (!users[userId]) return ctx.answerCbQuery("المستخدم غير موجود.");
  users[userId].status = "active";
  users[userId].start = Date.now();
  users[userId].expire = Date.now() + daysToMs(30);

  // إضافة المستخدم للقناة (البوت يجب أن يكون مشرفاً)
  try {
    await ctx.telegram.unbanChatMember(CHANNEL_ID, userId);
  } catch (e) {}
  notifyUser(bot, userId, "تم تفعيل اشتراكك في القناة لمدة 30 يوماً.\nسيتم إعلامك قبل انتهاء الاشتراك.");
  ctx.answerCbQuery("تم تفعيل الاشتراك.");

  // جدولة التنبيه بعد 25 يوم
  setTimeout(() => {
    notifyUser(bot, userId, "تبقى 5 أيام على انتهاء اشتراكك، يرجى التجديد إذا رغبت بالبقاء.");
    users[userId].notified = true;
  }, daysToMs(25));

  // جدولة الطرد بعد 30 يوم إلا إذا جدد
  setTimeout(() => {
    if (users[userId] && users[userId].status === "active") {
      kickFromChannel(bot, userId);
      users[userId].status = "expired";
      notifyUser(bot, userId, "تم انتهاء الاشتراك وتم طردك من القناة.");
    }
  }, daysToMs(30));
});

// رفض الاشتراك
bot.action(/reject_(\d+)/, (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return ctx.answerCbQuery();
  const userId = parseInt(ctx.match[1]);
  if (users[userId]) users[userId].status = "rejected";
  notifyUser(bot, userId, "تم رفض طلب الاشتراك.");
  ctx.answerCbQuery("تم رفض الطلب.");
});

// زر التجديد
bot.command("renew", (ctx) => {
  const userId = ctx.from.id;
  if (users[userId]?.status !== "active" && users[userId]?.status !== "expired") {
    ctx.reply("يجب أن تكون مشتركاً لتجديد الاشتراك.");
    return;
  }
  users[userId].renewRequest = true;
  sendRenewRequest(ctx, userId);
  ctx.reply("تم إرسال طلب تجديد الاشتراك للمشرف.");
});

// موافقة المشرف على التجديد
bot.action(/renew_(\d+)/, (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return ctx.answerCbQuery();
  const userId = parseInt(ctx.match[1]);
  if (!users[userId]) return ctx.answerCbQuery("المستخدم غير موجود.");
  users[userId].status = "active";
  users[userId].start = Date.now();
  users[userId].expire = Date.now() + daysToMs(30);
  notifyUser(bot, userId, "تم تجديد الاشتراك لمدة 30 يوماً.");
  ctx.answerCbQuery("تم التجديد.");
});

// رفض تجديد
bot.action(/denyrenew_(\d+)/, (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return ctx.answerCbQuery();
  const userId = parseInt(ctx.match[1]);
  notifyUser(bot, userId, "تم رفض طلب تجديد الاشتراك.");
  ctx.answerCbQuery("تم رفض طلب التجديد.");
});

// إعداد webhook handler
module.exports.handler = async (event, context) => {
  // تأكد من أن الطلب من Telegram (POST فقط)
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }
  await bot.handleUpdate(JSON.parse(event.body));
  return { statusCode: 200, body: '' };
};