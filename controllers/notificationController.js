const { Expo } = require('expo-server-sdk');
const User = require('../models/User');

// Single shared Expo client (handles connection pooling).
let expo = null;
const getExpo = () => {
  if (!expo) expo = new Expo({ accessToken: process.env.EXPO_PUSH_ACCESS_TOKEN || undefined });
  return expo;
};

// Filter out malformed tokens and dedupe.
const validTokens = (tokens) => {
  const seen = new Set();
  const list = [];
  for (const t of tokens) {
    if (!t || !Expo.isExpoPushToken(t) || seen.has(t)) continue;
    seen.add(t);
    list.push(t);
  }
  return list;
};

// Fire-and-forget push to a list of user documents (each with expoPushToken).
// Never throws — notification failure must not break business flows.
async function sendPushToUsers(users, title, body, data = {}) {
  try {
    const tokens = validTokens((users || []).map((u) => u.expoPushToken));
    if (tokens.length === 0) return;

    const messages = tokens.map((to) => ({
      to,
      sound: 'default',
      title,
      body,
      data,
    }));

    const chunks = getExpo().chunkPushNotifications(messages);
    const tickets = [];
    for (const chunk of chunks) {
      try {
        // expo-server-sdk v7 API — sends one chunk, returns one ticket per message.
        const ticketChunk = await getExpo().sendPushNotificationsAsync(chunk);
        tickets.push(...ticketChunk);
      } catch (err) {
        console.error('[PUSH] chunk send failed:', err.message);
      }
    }

    // Surface individual ticket errors (e.g. invalid tokens) without throwing.
    tickets.forEach((ticket) => {
      if (ticket.status === 'error') {
        console.error(`[PUSH] ticket error: ${ticket.message} (${ticket.details?.error || 'unknown'})`);
      }
    });
  } catch (err) {
    console.error('[PUSH] sendPushToUsers failed:', err.message);
  }
}

// Notify every active admin with a registered push token.
async function notifyAdmins(title, body, data = {}) {
  try {
    const admins = await User.find({
      role: 'admin',
      isActive: true,
      expoPushToken: { $ne: null },
    }).select('expoPushToken');
    await sendPushToUsers(admins, title, body, data);
  } catch (err) {
    console.error('[PUSH] notifyAdmins failed:', err.message);
  }
}

// Notify a single user document by id.
async function notifyUser(userId, title, body, data = {}) {
  try {
    const user = await User.findById(userId).select('expoPushToken');
    if (!user) return;
    await sendPushToUsers([user], title, body, data);
  } catch (err) {
    console.error('[PUSH] notifyUser failed:', err.message);
  }
}

module.exports = { sendPushToUsers, notifyAdmins, notifyUser };
