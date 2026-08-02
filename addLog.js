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
    const data = JSON.parse(event.body || "{}");
    
    // 優先讀取獨立的 action 與 feeling，若舊捷徑只傳 content 也能相容
    const action = data.action || data.content;
    const feeling = data.feeling || "";

    if (!action || !action.trim()) {
      return { statusCode: 400, body: JSON.stringify({ error: "做什麼事情不能為空" }) };
    }

    // 取得台灣時間與日期
    const now = new Date();
    const localDate = new Date(now.getTime() + (8 * 60 * 60 * 1000)); // UTC+8
    const dateStr = localDate.toISOString().split('T')[0];
    const timeStr = localDate.toISOString().split('T')[1].substring(0, 5);

    // 寫入 Firestore
    await db.collection("logs").add({
      date: dateStr,
      time: timeStr,
      type: "timeline",
      action: action.trim(),
      feeling: feeling.trim(),
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
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: error.message })
    };
  }
};
