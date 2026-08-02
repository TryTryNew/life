// netlify/functions/addLog.js
const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

// 初始化 Firebase Admin
if (!getApps().length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  initializeApp({
    credential: cert(serviceAccount)
  });
}

const db = getFirestore();

exports.handler = async (event, context) => {
  // 只允許 POST 請求
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const data = JSON.parse(event.body);
    const content = data.content;

    if (!content || !content.trim()) {
      return { statusCode: 400, body: JSON.stringify({ error: "內容不能為空" }) };
    }

    // 取得台灣時間與日期
    const now = new Date();
    // 轉為 YYYY-MM-DD
    const localDate = new Date(now.getTime() + (8 * 60 * 60 * 1000)); // UTC+8
    const dateStr = localDate.toISOString().split('T')[0];
    // 轉為 HH:mm
    const timeStr = localDate.toISOString().split('T')[1].substring(0, 5);

    // 寫入與你的 PWA 格式完全一致的 Firestore logs 格式
    await db.collection("logs").add({
      date: dateStr,
      time: timeStr,
      type: "timeline",
      action: content,
      feeling: "",
      source: "ios_shortcut",
      updatedAt: FieldValue.serverTimestamp()
    });

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "success", message: "成功紀錄至生活日誌！" })
    };
  } catch (error) {
    console.error("Firebase Error:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};
