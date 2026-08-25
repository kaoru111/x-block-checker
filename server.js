const express = require("express");
const crypto = require("crypto");
const path = require("path");
const rateLimit = require("express-rate-limit");

const app = express();
const PORT = Number(process.env.PORT || 3000);

// Abasthanなどのリバースプロキシに対応
app.set("trust proxy", 1);

// Telegram情報は環境変数から取得
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

const norm = (v) =>
  String(v || "")
    .trim()
    .replace(/^@+/, "")
    .replace(/\s/g, "");


/*
 * 同じユーザー名なら同じブロック数になる計算
 * フォロワー数の0～5%の範囲
 */
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


/*
 * X公開ページからユーザー情報を取得
 *
 * Xへアクセスするときは
 * User-Agentを必ず付ける。
 */
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

  const response =
    await fetch(
      xUrl,
      {
        method: "GET",

        redirect: "follow",

        headers: {

          // User-Agent
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


  /*
   * 存在しないアカウント・停止アカウント
   */
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


  /*
   * パターン1
   *
   * "followers_count":123
   */
  const pattern1 =
    /"followers_count"\s*:\s*(\d+)/i;

  const match1 =
    html.match(pattern1);

  if (match1) {

    followers =
      Number(match1[1]);

    console.log(
      "フォロワー数取得成功 pattern1:",
      followers
    );
  }


  /*
   * パターン2
   *
   * "followersCount":123
   */
  if (followers === null) {

    const pattern2 =
      /"followersCount"\s*:\s*(\d+)/i;

    const match2 =
      html.match(pattern2);

    if (match2) {

      followers =
        Number(match2[1]);

      console.log(
        "フォロワー数取得成功 pattern2:",
        followers
      );
    }
  }


  /*
   * パターン3
   *
   * エスケープされたJSON
   */
  if (followers === null) {

    const pattern3 =
      /followers_count\\?["']?\s*[:=]\s*(\d+)/i;

    const match3 =
      html.match(pattern3);

    if (match3) {

      followers =
        Number(match3[1]);

      console.log(
        "フォロワー数取得成功 pattern3:",
        followers
      );
    }
  }


  /*
   * パターン4
   *
   * HTMLのmeta description等に
   * 「123 Followers」
   * のように入っている場合
   */
  if (followers === null) {

    const followerPatterns = [

      /([\d,.\s]+)\s+Followers\b/i,

      /([\d,.\s]+)\s+フォロワー/i,

      /Followers\s*[:：]\s*([\d,.\s]+)/i,

      /フォロワー\s*[:：]\s*([\d,.\s]+)/i
    ];

    for (
      const pattern
      of followerPatterns
    ) {

      const match =
        html.match(pattern);

      if (match) {

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
  }


  /*
   * 数字が取得できなかった場合
   *
   * 勝手な数字は返さない。
   */
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


/*
 * Telegram送信
 *
 * 成功するまで待つ。
 * 失敗したらエラーにする。
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

  console.log(
    "Telegram送信成功"
  );

  return true;
}


/*
 * チェックAPI
 */
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


      /*
       * 入力チェック
       */
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


      /*
       * Xプロフィール取得
       */
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

              error:
                "user_not_found"
            });
        }

        throw error;
      }


      /*
       * ブロック数計算
       */
      const blocked =
        calc(
          user,
          profile.followers
        );


      /*
       * Telegram送信
       *
       * ここで待機する。
       *
       * Telegram送信に失敗した場合、
       * success:true は返さない。
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
       * Telegram送信成功後のみ
       * 成功結果を返す。
       */
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

          error:
            "server_error"
        });
    }
  }
);


/*
 * サーバー起動
 */
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
