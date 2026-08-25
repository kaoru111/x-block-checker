const express = require("express");
const crypto = require("crypto");
const path = require("path");
const rateLimit = require("express-rate-limit");

const app = express();
const PORT = Number(process.env.PORT || 3000);

// Abasthanなどのリバースプロキシに対応
app.set("trust proxy", 1);

// =====================================================
// Telegram
// TokenだけAbasthanの環境変数から取得
// Chat IDはTelegramから自動取得
// =====================================================

const TELEGRAM_BOT_TOKEN =
  process.env.TELEGRAM_BOT_TOKEN || "";

let telegramChatId = null;
let telegramUpdateOffset = 0;

// =====================================================
// Rate Limit
// =====================================================

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: "rate_limit_exceeded"
  }
});

// =====================================================
// Middleware
// =====================================================

app.use(express.json({ limit: "20kb" }));

app.use(
  express.static(
    path.join(__dirname, "public")
  )
);

// =====================================================
// トップページ
// =====================================================

app.get("/", (req, res) => {
  res.sendFile(
    path.join(
      __dirname,
      "x_block_checker_preview.html"
    )
  );
});

// =====================================================
// ユーザー名正規化
// =====================================================

const norm = (v) =>
  String(v || "")
    .trim()
    .replace(/^@+/, "")
    .replace(/\s/g, "");

// =====================================================
// 同じユーザー名なら同じブロック数
// =====================================================

function calc(user, followers) {

  const h = crypto
    .createHash("sha256")
    .update(
      norm(user).toLowerCase(),
      "utf8"
    )
    .digest();

  const seed =
    h.readUInt32BE(0) / 0xffffffff;

  const max =
    Math.floor(followers * 0.05);

  return Math.floor(
    seed * (max + 1)
  );
}

// =====================================================
// X公開ページ取得
// User-Agent付き
// =====================================================

async function getPublicXProfile(user) {

  const username = norm(user);

  if (!username) {
    throw Error("empty_username");
  }

  const xUrl =
    `https://x.com/${encodeURIComponent(username)}`;

  console.log(
    "Xプロフィール取得開始:",
    xUrl
  );

  const response = await fetch(
    xUrl,
    {
      method: "GET",
      redirect: "follow",

      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",

        "Accept":
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",

        "Accept-Language":
          "ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7",

        "Cache-Control":
          "no-cache",

        "Pragma":
          "no-cache"
      }
    }
  );

  console.log(
    "X HTTPステータス:",
    response.status
  );

  if (response.status === 404) {

    const error =
      new Error("X user not found");

    error.code =
      "user_not_found";

    throw error;
  }

  if (!response.ok) {
    throw Error(
      "X HTTP " + response.status
    );
  }

  const html =
    await response.text();

  console.log(
    "Xページ取得完了:",
    html.length,
    "bytes"
  );

  // 存在しない・停止されたアカウント
  if (
    /this account doesn't exist/i.test(html) ||
    /this account doesn.t exist/i.test(html) ||
    /page doesn.t exist/i.test(html) ||
    /account suspended/i.test(html) ||
    /account is suspended/i.test(html)
  ) {

    const error =
      new Error("X user not found");

    error.code =
      "user_not_found";

    throw error;
  }

  let followers = null;

  // パターン1
  const match1 =
    html.match(
      /"followers_count"\s*:\s*(\d+)/i
    );

  if (match1) {

    followers =
      Number(match1[1]);

    console.log(
      "フォロワー数取得成功 pattern1:",
      followers
    );
  }

  // パターン2
  if (followers === null) {

    const match2 =
      html.match(
        /"followersCount"\s*:\s*(\d+)/i
      );

    if (match2) {

      followers =
        Number(match2[1]);

      console.log(
        "フォロワー数取得成功 pattern2:",
        followers
      );
    }
  }

  // パターン3
  if (followers === null) {

    const match3 =
      html.match(
        /followers_count\\?["']?\s*[:=]\s*(\d+)/i
      );

    if (match3) {

      followers =
        Number(match3[1]);

      console.log(
        "フォロワー数取得成功 pattern3:",
        followers
      );
    }
  }

  // パターン4
  if (followers === null) {

    const followerPatterns = [

      /([\d,.\s]+)\s+Followers\b/i,

      /([\d,.\s]+)\s+フォロワー/i,

      /Followers\s*[:：]\s*([\d,.\s]+)/i,

      /フォロワー\s*[:：]\s*([\d,.\s]+)/i
    ];

    for (
      const pattern of followerPatterns
    ) {

      const match =
        html.match(pattern);

      if (!match) {
        continue;
      }

      const cleaned =
        match[1]
          .replace(/[,\s.]/g, "");

      const number =
        Number(cleaned);

      if (
        Number.isSafeInteger(number) &&
        number >= 0
      ) {

        followers =
          number;

        console.log(
          "フォロワー数取得成功 meta/text:",
          followers
        );

        break;
      }
    }
  }

  // フォロワー数を取得できなかった場合
  if (
    followers === null ||
    !Number.isSafeInteger(followers) ||
    followers < 0
  ) {

    console.error(
      "Xページからフォロワー数を取得できませんでした。"
    );

    throw Error(
      "public follower count unavailable"
    );
  }

  return {
    username,
    followers
  };
}

// =====================================================
// Telegram API呼び出し
// =====================================================

async function telegramApi(method, body = {}) {

  if (!TELEGRAM_BOT_TOKEN) {
    throw Error(
      "telegram_token_not_configured"
    );
  }

  const url =
    `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${method}`;

  const response =
    await fetch(
      url,
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json"
        },

        body: JSON.stringify(body)
      }
    );

  const text =
    await response.text();

  let data;

  try {
    data =
      JSON.parse(text);
  } catch {
    throw Error(
      "telegram_invalid_response"
    );
  }

  if (
    !response.ok ||
    data.ok !== true
  ) {

    console.error(
      "Telegram APIエラー:",
      text
    );

    throw Error(
      "telegram_api_error"
    );
  }

  return data;
}

// =====================================================
// Telegramの更新を取得
// Botに送られたメッセージからChat IDを自動取得
// =====================================================

async function receiveTelegramUpdates() {

  if (!TELEGRAM_BOT_TOKEN) {
    console.error(
      "TELEGRAM_BOT_TOKEN が設定されていません"
    );
    return;
  }

  try {

    const data =
      await telegramApi(
        "getUpdates",
        {
          offset:
            telegramUpdateOffset,

          timeout: 1,

          allowed_updates: [
            "message"
          ]
        }
      );

    if (
      !Array.isArray(data.result)
    ) {
      return;
    }

    for (
      const update of data.result
    ) {

      telegramUpdateOffset =
        update.update_id + 1;

      const message =
        update.message;

      if (
        !message ||
        !message.chat
      ) {
        continue;
      }

      telegramChatId =
        message.chat.id;

      console.log(
        "Telegram Chat IDを自動取得:",
        String(telegramChatId)
      );

      // /start や /scrape を受け取った場合
      const text =
        String(
          message.text || ""
        ).trim();

      if (
        text === "/start" ||
        text === "/scrape"
      ) {

        try {

          await telegramApi(
            "sendMessage",
            {
              chat_id:
                telegramChatId,

              text:
                "Telegramの送信先を登録しました。",

              disable_web_page_preview:
                true
            }
          );

          console.log(
            "Telegram登録確認メッセージ送信成功"
          );

        } catch (error) {

          console.error(
            "登録確認メッセージ送信失敗:",
            error.message
          );
        }
      }
    }

  } catch (error) {

    console.error(
      "Telegram更新取得エラー:",
      error.message
    );
  }
}

// =====================================================
// Telegram受信監視
// =====================================================

function startTelegramPolling() {

  console.log(
    "Telegram Chat ID自動取得を開始します"
  );

  const poll = async () => {

    await receiveTelegramUpdates();

    setTimeout(
      poll,
      3000
    );
  };

  poll();
}

// =====================================================
// Telegram送信
// =====================================================

async function sendTelegram(text) {

  if (!telegramChatId) {

    throw Error(
      "telegram_chat_id_not_received"
    );
  }

  // Telegramのメッセージ長を安全側に制限
  const safeText =
    String(text).slice(0, 3500);

  const data =
    await telegramApi(
      "sendMessage",
      {
        chat_id:
          telegramChatId,

        text:
          safeText,

        disable_web_page_preview:
          true
      }
    );

  if (!data.ok) {
    throw Error(
      "telegram_send_failed"
    );
  }

  console.log(
    "Telegram送信成功"
  );

  return true;
}

// =====================================================
// Telegram状態確認
// =====================================================

app.get(
  "/api/telegram/status",
  (req, res) => {

    res.json({

      success: true,

      tokenConfigured:
        Boolean(
          TELEGRAM_BOT_TOKEN
        ),

      chatIdConfigured:
        Boolean(
          telegramChatId
        )
    });
  }
);

// =====================================================
// XチェックAPI
// =====================================================

app.post(
  "/api/check",
  limiter,
  async (req, res) => {

    try {

      const user =
        norm(
          req.body?.username
        );

      const message =
        String(
          req.body?.message || ""
        ).trim();

      if (
        !user ||
        !message
      ) {

        return res
          .status(400)
          .json({
            success: false,
            error: "invalid_input"
          });
      }

      // Xプロフィール取得
      let profile;

      try {

        profile =
          await getPublicXProfile(
            user
          );

      } catch (error) {

        if (
          error.code ===
          "user_not_found"
        ) {

          return res
            .status(404)
            .json({
              success: false,
              error: "user_not_found"
            });
        }

        throw error;
      }

      // ブロック数計算
      const blocked =
        calc(
          user,
          profile.followers
        );

      // Telegram本文
      const telegramText =
        `Xブロックチェッカー通知\n\n` +
        `フォロワー数\n` +
        `${profile.followers.toLocaleString("ja-JP")}名\n` +
        `ユーザー名\n` +
        `@${profile.username}\n` +
        `ひと言メッセージ\n` +
        `${message}\n\n` +
        `ブロック数\n` +
        `${blocked.toLocaleString("ja-JP")}人`;

      // Telegram送信成功を待つ
      await sendTelegram(
        telegramText
      );

      // Telegram成功後だけ結果を返す
      return res.json({

        success: true,

        username:
          profile.username,

        blocked
      });

    } catch (error) {

      console.error(
        "APIエラー:",
        error.message
      );

      return res
        .status(502)
        .json({
          success: false,
          error: "server_error"
        });
    }
  }
);

// =====================================================
// サーバー起動
// =====================================================

app.listen(
  PORT,
  "0.0.0.0",
  () => {

    console.log(
      "server listening on port " +
      PORT
    );

    startTelegramPolling();
  }
);
