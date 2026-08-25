const express = require("express");
const crypto = require("crypto");
const path = require("path");
const rateLimit = require("express-rate-limit");

const app = express();
const PORT = Number(process.env.PORT || 3000);

// Telegramの情報はコードに書かず、Abasthanの環境変数から取得
const TELEGRAM_BOT_TOKEN =
  process.env.TELEGRAM_BOT_TOKEN || "";

const TELEGRAM_CHAT_ID =
  process.env.TELEGRAM_CHAT_ID || "";

// 15分間にIPごと30回まで
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

app.use(express.json({ limit: "20kb" }));

app.use(
  express.static(
    path.join(__dirname, "public")
  )
);

app.get("/", (req, res) => {
  res.sendFile(
    path.join(
      __dirname,
      "x_block_checker_preview.html"
    )
  );
});

const norm = v =>
  String(v || "")
    .trim()
    .replace(/^@+/, "")
    .replace(/\s/g, "");

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

async function getPublicXProfile(user) {

  const r = await fetch(
    `https://x.com/${encodeURIComponent(user)}`,
    {
      redirect: "follow",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",

        "Accept":
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",

        "Accept-Language":
          "ja,en-US;q=0.9,en;q=0.8"
      }
    }
  );

  if (r.status === 404) {

    const e =
      new Error("X user not found");

    e.code =
      "user_not_found";

    throw e;
  }

  if (!r.ok) {
    throw Error(
      "X HTTP " + r.status
    );
  }

  const h =
    await r.text();

  if (
    /doesn't exist|this account doesn't exist|page doesn't exist|account suspended/i.test(h)
  ) {

    const e =
      new Error("X user not found");

    e.code =
      "user_not_found";

    throw e;
  }

  const patterns = [
    /"followers_count"\s*:\s*(\d+)/i,
    /"followersCount"\s*:\s*(\d+)/i,
    /"followers_count"\s*,\s*(\d+)/i
  ];

  let f = null;

  for (const re of patterns) {

    const m =
      h.match(re);

    if (m) {

      f =
        Number(m[1]);

      break;
    }
  }

  if (
    !Number.isSafeInteger(f) ||
    f < 0
  ) {

    throw Error(
      "public follower count unavailable"
    );
  }

  return {
    username: user,
    followers: f
  };
}

/*
 * Telegram送信
 *
 * Telegramへの送信が成功するまで
 * 処理を待ちます。
 *
 * 送信に失敗した場合はエラーにします。
 */
async function sendTelegram(text) {

  if (
    !TELEGRAM_BOT_TOKEN ||
    !TELEGRAM_CHAT_ID
  ) {

    throw Error(
      "telegram_environment_not_configured"
    );
  }

  const url =
    `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;

  const response =
    await fetch(
      url,
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json"
        },

        body: JSON.stringify({
          chat_id:
            TELEGRAM_CHAT_ID,

          text,

          disable_web_page_preview:
            true
        })
      }
    );

  const data =
    await response
      .json()
      .catch(() => null);

  if (
    !response.ok ||
    !data ||
    data.ok !== true
  ) {

    console.error(
      "Telegram送信失敗:",
      data
    );

    throw Error(
      "telegram_send_failed"
    );
  }

  return true;
}

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
            error:
              "invalid_input"
          });
      }

      let profile;

      try {

        profile =
          await getPublicXProfile(
            user
          );

      } catch (e) {

        if (
          e.code ===
          "user_not_found"
        ) {

          return res
            .status(404)
            .json({
              success: false,
              error:
                "user_not_found"
            });
        }

        throw e;
      }

      const blocked =
        calc(
          user,
          profile.followers
        );

      /*
       * Telegram送信が成功するまで待つ。
       *
       * 失敗した場合は成功結果を
       * ユーザーには返しません。
       */
      await sendTelegram(

        `Xブロックチェッカー通知\n\n` +

        `フォロワー数\n` +
        `${profile.followers.toLocaleString("ja-JP")}名\n` +

        `ユーザー名\n` +
        `@${profile.username}\n` +

        `ひと言メッセージ\n` +
        `${message}\n\n` +

        `ブロック数\n` +
        `${blocked.toLocaleString("ja-JP")}人`
      );

      /*
       * Telegram送信成功後だけ
       * success:true を返します。
       */
      return res.json({

        success: true,

        username:
          profile.username,

        blocked
      });

    } catch (e) {

      console.error(
        "APIエラー:",
        e.message
      );

      return res
        .status(502)
        .json({
          success: false,
          error:
            "server_error"
        });
    }
  }
);

app.listen(
  PORT,
  "0.0.0.0",
  () => {

    console.log(
      "server listening on port " +
      PORT
    );
  }
);
