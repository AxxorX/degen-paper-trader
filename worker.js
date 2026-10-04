// @ts-nocheck

const CHAINS = {
  solana: {
    name: "Solana",
    dex: "solana",
    emoji: "🟣"
  },
  arc: {
    name: "Arc",
    dex: "arc",
    emoji: "🔵"
  },
  robinhood: {
    name: "Robinhood",
    dex: "robinhood",
    emoji: "🟠"
  }
};

const STARTING_BALANCE = 150;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Health
    if (request.method === "GET" && url.pathname === "/") {
      return Response.json({
        ok: true,
        bot: "Degen Paper Trader",
        status: "online",
        version: "1.0.0"
      });
    }

    // Setup Telegram webhook
    if (request.method === "GET" && url.pathname === "/setup") {
      const key = url.searchParams.get("key");

      if (!key || key !== env.SETUP_KEY) {
        return Response.json(
          { ok: false, error: "Unauthorized" },
          { status: 401 }
        );
      }

      const webhookUrl = `${url.origin}/telegram`;

      const result = await telegram(env, "setWebhook", {
        url: webhookUrl,
        secret_token: env.WEBHOOK_SECRET,
        allowed_updates: ["message", "callback_query"],
        drop_pending_updates: true
      });

      return Response.json({
        ok: result.ok,
        webhook: webhookUrl,
        telegram: result
      });
    }

    // Telegram webhook
    if (request.method === "POST" && url.pathname === "/telegram") {
      const incomingSecret =
        request.headers.get("X-Telegram-Bot-Api-Secret-Token");

      if (incomingSecret !== env.WEBHOOK_SECRET) {
        return new Response("Unauthorized", { status: 401 });
      }

      const update = await request.json();

      try {
        await handleUpdate(update, env);
      } catch (error) {
        console.error("UPDATE ERROR", error);
      }

      return new Response("OK");
    }

    return Response.json({
      ok: false,
      error: "Not found"
    }, { status: 404 });
  }
};


// ============================================================
// TELEGRAM
// ============================================================

async function telegram(env, method, body = null) {
  const url =
    `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`;

  const options = {
    method: body ? "POST" : "GET",
    headers: {
      "Content-Type": "application/json"
    }
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);
  return await response.json();
}


async function sendMessage(env, chatId, text, keyboard = null) {
  const body = {
    chat_id: chatId,
    text,
    parse_mode: "HTML"
  };

  if (keyboard) {
    body.reply_markup = {
      inline_keyboard: keyboard
    };
  }

  return telegram(env, "sendMessage", body);
}


async function sendPhoto(env, chatId, photo, caption, keyboard = null) {
  const body = {
    chat_id: chatId,
    photo,
    caption,
    parse_mode: "HTML"
  };

  if (keyboard) {
    body.reply_markup = {
      inline_keyboard: keyboard
    };
  }

  return telegram(env, "sendPhoto", body);
}


async function answerCallback(env, id, text = "") {
  return telegram(env, "answerCallbackQuery", {
    callback_query_id: id,
    text
  });
}


async function editMessage(env, chatId, messageId, text, keyboard = null) {
  const body = {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: "HTML"
  };

  if (keyboard) {
    body.reply_markup = {
      inline_keyboard: keyboard
    };
  }

  return telegram(env, "editMessageText", body);
}


// ============================================================
// DATABASE
// ============================================================

async function ensureUser(env, tgUser) {
  const now = Date.now();

  let user = await env.DB
    .prepare("SELECT * FROM users WHERE telegram_id = ?")
    .bind(String(tgUser.id))
    .first();

  if (!user) {
    const result = await env.DB
      .prepare(`
        INSERT INTO users
        (telegram_id, username, created_at, updated_at)
        VALUES (?, ?, ?, ?)
      `)
      .bind(
        String(tgUser.id),
        tgUser.username || null,
        now,
        now
      )
      .run();

    const userId = result.meta.last_row_id;

    await env.DB
      .prepare(`
        INSERT INTO wallets
        (user_id, starting_balance, cash_balance,
         realized_pnl, total_fees, created_at, updated_at)
        VALUES (?, ?, ?, 0, 0, ?, ?)
      `)
      .bind(
        userId,
        STARTING_BALANCE,
        STARTING_BALANCE,
        now,
        now
      )
      .run();

    await env.DB
      .prepare(`
        INSERT INTO user_sessions
        (user_id, state, data, updated_at)
        VALUES (?, 'idle', '{}', ?)
      `)
      .bind(userId, now)
      .run();

    user = await env.DB
      .prepare("SELECT * FROM users WHERE id = ?")
      .bind(userId)
      .first();
  } else {
    await env.DB
      .prepare(`
        UPDATE users
        SET username = ?, updated_at = ?
        WHERE id = ?
      `)
      .bind(
        tgUser.username || null,
        now,
        user.id
      )
      .run();
  }

  return user;
}


async function getSession(env, userId) {
  return env.DB
    .prepare("SELECT * FROM user_sessions WHERE user_id = ?")
    .bind(userId)
    .first();
}


async function setSession(env, userId, state, data = {}) {
  await env.DB
    .prepare(`
      INSERT INTO user_sessions
      (user_id, state, data, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id)
      DO UPDATE SET
        state = excluded.state,
        data = excluded.data,
        updated_at = excluded.updated_at
    `)
    .bind(
      userId,
      state,
      JSON.stringify(data),
      Date.now()
    )
    .run();
}


async function clearSession(env, userId) {
  await setSession(env, userId, "idle", {});
}


async function getWallet(env, userId) {
  return env.DB
    .prepare("SELECT * FROM wallets WHERE user_id = ?")
    .bind(userId)
    .first();
}


// ============================================================
// MARKET DATA
// ============================================================

async function getTokenData(chain, ca) {
  const config = CHAINS[chain];

  if (!config) {
    throw new Error("Unsupported chain");
  }

  let pairs = [];

  // Primary endpoint
  try {
    const response = await fetch(
      `https://api.dexscreener.com/token-pairs/v1/${config.dex}/${encodeURIComponent(ca)}`
    );

    if (response.ok) {
      const data = await response.json();

      if (Array.isArray(data)) {
        pairs = data;
      }
    }
  } catch (e) {
    console.log("Primary market API failed");
  }

  // Fallback search
  if (!pairs.length) {
    try {
      const response = await fetch(
        `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(ca)}`
      );

      if (response.ok) {
        const data = await response.json();

        pairs = (data.pairs || []).filter(
          p =>
            p.chainId === config.dex &&
            p.baseToken?.address?.toLowerCase() === ca.toLowerCase()
        );
      }
    } catch (e) {
      console.log("Fallback market API failed");
    }
  }

  if (!pairs.length) {
    throw new Error(
      "Token not found on DEX Screener for this chain."
    );
  }

  // Only use pairs where our CA is base token
  const valid = pairs.filter(
    p =>
      p.baseToken?.address?.toLowerCase() === ca.toLowerCase()
  );

  if (!valid.length) {
    throw new Error("No valid trading pair found.");
  }

  // Strongest pair by liquidity
  valid.sort(
    (a, b) =>
      (b.liquidity?.usd || 0) -
      (a.liquidity?.usd || 0)
  );

  const p = valid[0];

  return {
    chain,
    chainName: config.name,
    ca,
    name: p.baseToken?.name || "Unknown Token",
    symbol: p.baseToken?.symbol || "UNKNOWN",
    price: Number(p.priceUsd || 0),
    mcap: p.marketCap ?? null,
    liquidity: p.liquidity?.usd ?? null,
    volume5m: p.volume?.m5 ?? null,
    volume1h: p.volume?.h1 ?? null,
    volume24h: p.volume?.h24 ?? null,
    image: p.info?.imageUrl || null,
    pairUrl: p.url || null,
    pairCreatedAt: p.pairCreatedAt || null
  };
}


// ============================================================
// FORMATTING
// ============================================================

function money(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) {
    return "Unknown";
  }

  return `$${Number(value).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}


function compactMoney(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) {
    return "Unknown";
  }

  const n = Number(value);

  if (Math.abs(n) >= 1_000_000_000) {
    return `$${(n / 1_000_000_000).toFixed(2)}B`;
  }

  if (Math.abs(n) >= 1_000_000) {
    return `$${(n / 1_000_000).toFixed(2)}M`;
  }

  if (Math.abs(n) >= 1_000) {
    return `$${(n / 1_000).toFixed(2)}K`;
  }

  return money(n);
}


function price(value) {
  if (!value || !Number.isFinite(Number(value))) {
    return "Unknown";
  }

  const n = Number(value);

  if (n < 0.000001) {
    return `$${n.toExponential(4)}`;
  }

  if (n < 0.01) {
    return `$${n.toFixed(8)}`;
  }

  return `$${n.toFixed(6)}`;
}


function percent(value) {
  const n = Number(value || 0);

  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}


function multiple(current, entry) {
  if (!current || !entry) return "0.00x";

  return `${(Number(current) / Number(entry)).toFixed(2)}x`;
}


function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}


// ============================================================
// KEYBOARDS
// ============================================================

function mainKeyboard() {
  return [
    [
      { text: "⚡ TRADE", callback_data: "trade" },
      { text: "📊 POSITIONS", callback_data: "positions" }
    ],
    [
      { text: "💰 WALLET", callback_data: "wallet" },
      { text: "📜 HISTORY", callback_data: "history" }
    ]
  ];
}


function backKeyboard() {
  return [
    [{ text: "← Back", callback_data: "home" }]
  ];
}


function chainKeyboard() {
  return [
    [
      { text: "🟣 Solana", callback_data: "chain:solana" }
    ],
    [
      { text: "🔵 Arc", callback_data: "chain:arc" }
    ],
    [
      { text: "🟠 Robinhood", callback_data: "chain:robinhood" }
    ],
    [
      { text: "← Back", callback_data: "home" }
    ]
  ];
}


// ============================================================
// MAIN MENU
// ============================================================

async function showHome(env, chatId, userId, messageId = null) {
  const wallet = await getWallet(env, userId);

  const positions = await env.DB
    .prepare(`
      SELECT *
      FROM positions
      WHERE user_id = ?
      ORDER BY created_at DESC
    `)
    .bind(userId)
    .all();

  let holdings = 0;
  let unrealized = 0;

  for (const p of positions.results || []) {
    try {
      const market = await getTokenData(p.chain, p.ca);

      const value = Number(p.quantity) * market.price;
      const pnl = value - Number(p.invested_usd);

      holdings += value;
      unrealized += pnl;
    } catch (e) {
      holdings += 0;
    }
  }

  const cash = Number(wallet.cash_balance);
  const total = cash + holdings;
  const totalPnl =
    Number(wallet.realized_pnl) + unrealized;

  const text = `
🦍 <b>DEGEN PAPER TRADER</b>

💰 Cash: <b>${money(cash)}</b>
📊 Portfolio: <b>${money(total)}</b>
📈 PnL: <b>${totalPnl >= 0 ? "+" : ""}${money(totalPnl)}</b>

Paper Capital: ${money(wallet.starting_balance)}
  `.trim();

  if (messageId) {
    return editMessage(
      env,
      chatId,
      messageId,
      text,
      mainKeyboard()
    );
  }

  return sendMessage(
    env,
    chatId,
    text,
    mainKeyboard()
  );
}


// ============================================================
// TRADE FLOW
// ============================================================

async function showChains(env, chatId, messageId = null) {
  const text = `
⚡ <b>TRADE</b>

Select a chain:
`.trim();

  if (messageId) {
    return editMessage(
      env,
      chatId,
      messageId,
      text,
      chainKeyboard()
    );
  }

  return sendMessage(
    env,
    chatId,
    text,
    chainKeyboard()
  );
}


async function askCA(env, chatId, userId, chain) {
  await setSession(env, userId, "awaiting_ca", { chain });

  const c = CHAINS[chain];

  return sendMessage(
    env,
    chatId,
    `
${c.emoji} <b>${c.name}</b>

Paste the token CA 👇

Send the contract address as a message.
    `.trim(),
    backKeyboard()
  );
}


async function showToken(env, chatId, userId, token) {
  await setSession(
    env,
    userId,
    "awaiting_amount",
    { token }
  );

  const text = `
🪙 <b>${esc(token.symbol)}</b>
${esc(token.name)}

${token.chainName}

💵 Price: <b>${price(token.price)}</b>
💰 MCap: <b>${compactMoney(token.mcap)}</b>
💧 Liquidity: <b>${compactMoney(token.liquidity)}</b>

CA:
<code>${esc(token.ca)}</code>

How much do you want to buy?
`.trim();

  const keyboard = [
    [
      { text: "$1", callback_data: "buyamt:1" },
      { text: "$5", callback_data: "buyamt:5" },
      { text: "$10", callback_data: "buyamt:10" }
    ],
    [
      { text: "$25", callback_data: "buyamt:25" },
      { text: "$50", callback_data: "buyamt:50" },
      { text: "Custom", callback_data: "buycustom" }
    ],
    [
      { text: "← Back", callback_data: "trade" }
    ]
  ];

  if (token.image) {
    try {
      return await sendPhoto(
        env,
        chatId,
        token.image,
        text,
        keyboard
      );
    } catch (e) {
      console.log("Logo send failed");
    }
  }

  return sendMessage(
    env,
    chatId,
    text,
    keyboard
  );
}


async function showBuyConfirm(env, chatId, userId, amount) {
  const session = await getSession(env, userId);

  if (!session) return;

  const data = JSON.parse(session.data || "{}");
  const token = data.token;

  if (!token) return;

  const wallet = await getWallet(env, userId);

  if (Number(amount) > Number(wallet.cash_balance)) {
    return sendMessage(
      env,
      chatId,
      `❌ Not enough paper balance.\n\nAvailable: <b>${money(wallet.cash_balance)}</b>`,
      backKeyboard()
    );
  }

  const quantity = Number(amount) / Number(token.price);

  await setSession(
    env,
    userId,
    "confirm_buy",
    {
      token,
      amount: Number(amount)
    }
  );

  return sendMessage(
    env,
    chatId,
    `
🟢 <b>CONFIRM PAPER BUY</b>

Token: <b>$${esc(token.symbol)}</b>
Chain: ${esc(token.chainName)}

Price: ${price(token.price)}
MCap: ${compactMoney(token.mcap)}

Investment: <b>${money(amount)}</b>
Tokens: <b>${quantity.toLocaleString()}</b>

Balance after:
<b>${money(Number(wallet.cash_balance) - Number(amount))}</b>
`.trim(),
    [
      [
        { text: "✅ CONFIRM BUY", callback_data: "confirmbuy" }
      ],
      [
        { text: "❌ CANCEL", callback_data: "home" }
      ]
    ]
  );
}


async function executeBuy(env, chatId, userId) {
  const session = await getSession(env, userId);

  if (!session) return;

  const data = JSON.parse(session.data || "{}");

  const token = data.token;
  const amount = Number(data.amount);

  if (!token || !amount) return;

  const wallet = await getWallet(env, userId);

  if (amount > Number(wallet.cash_balance)) {
    return sendMessage(
      env,
      chatId,
      "❌ Insufficient paper balance.",
      mainKeyboard()
    );
  }

  // Refresh price before execution
  let market;

  try {
    market = await getTokenData(
      token.chain,
      token.ca
    );
  } catch (e) {
    return sendMessage(
      env,
      chatId,
      "❌ Could not refresh token price. Try again.",
      mainKeyboard()
    );
  }

  const executionPrice = market.price;
  const quantity = amount / executionPrice;
  const now = Date.now();

  const existing = await env.DB
    .prepare(`
      SELECT *
      FROM positions
      WHERE user_id = ?
      AND chain = ?
      AND ca = ?
      LIMIT 1
    `)
    .bind(userId, token.chain, token.ca)
    .first();

  if (existing) {
    const oldQty = Number(existing.quantity);
    const oldInvested = Number(existing.invested_usd);

    const newQty = oldQty + quantity;
    const newInvested = oldInvested + amount;

    const avgPrice = newInvested / newQty;

    const oldEntryMcap =
      Number(existing.entry_mcap || market.mcap || 0);

    const newEntryMcap =
      oldInvested > 0 && market.mcap
        ? (
            (oldEntryMcap * oldInvested) +
            (Number(market.mcap) * amount)
          ) / newInvested
        : market.mcap;

    await env.DB
      .prepare(`
        UPDATE positions
        SET
          entry_price = ?,
          current_price = ?,
          entry_mcap = ?,
          current_mcap = ?,
          quantity = ?,
          invested_usd = ?,
          remaining_invested_usd = ?,
          updated_at = ?
        WHERE id = ?
      `)
      .bind(
        avgPrice,
        executionPrice,
        newEntryMcap || null,
        market.mcap || null,
        newQty,
        newInvested,
        newInvested,
        now,
        existing.id
      )
      .run();

    await env.DB
      .prepare(`
        UPDATE wallets
        SET cash_balance = cash_balance - ?,
            updated_at = ?
        WHERE user_id = ?
      `)
      .bind(amount, now, userId)
      .run();

    await env.DB
      .prepare(`
        INSERT INTO trades
        (user_id, position_id, chain, ca, name, symbol,
         side, sell_percent, price, mcap, quantity,
         usd_amount, pnl_usd, pnl_percent, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 'BUY', NULL, ?, ?, ?, ?, 0, 0, ?)
      `)
      .bind(
        userId,
        existing.id,
        token.chain,
        token.ca,
        token.name,
        token.symbol,
        executionPrice,
        market.mcap || null,
        quantity,
        amount,
        now
      )
      .run();

  } else {
    const result = await env.DB
      .prepare(`
        INSERT INTO positions
        (user_id, chain, ca, name, symbol, logo_url,
         entry_price, current_price, entry_mcap,
         current_mcap, quantity, invested_usd,
         remaining_invested_usd, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(
        userId,
        token.chain,
        token.ca,
        token.name,
        token.symbol,
        token.image || null,
        executionPrice,
        executionPrice,
        market.mcap || null,
        market.mcap || null,
        quantity,
        amount,
        amount,
        now,
        now
      )
      .run();

    const positionId = result.meta.last_row_id;

    await env.DB
      .prepare(`
        UPDATE wallets
        SET cash_balance = cash_balance - ?,
            updated_at = ?
        WHERE user_id = ?
      `)
      .bind(amount, now, userId)
      .run();

    await env.DB
      .prepare(`
        INSERT INTO trades
        (user_id, position_id, chain, ca, name, symbol,
         side, sell_percent, price, mcap, quantity,
         usd_amount, pnl_usd, pnl_percent, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 'BUY', NULL, ?, ?, ?, ?, 0, 0, ?)
      `)
      .bind(
        userId,
        positionId,
        token.chain,
        token.ca,
        token.name,
        token.symbol,
        executionPrice,
        market.mcap || null,
        quantity,
        amount,
        now
      )
      .run();
  }

  await clearSession(env, userId);

  return sendMessage(
    env,
    chatId,
    `
✅ <b>PAPER BUY COMPLETE</b>

🪙 $${esc(token.symbol)}
${esc(token.chainName)}

Entry: ${price(executionPrice)}
MCap: ${compactMoney(market.mcap)}

Invested: <b>${money(amount)}</b>
Tokens: <b>${quantity.toLocaleString()}</b>

Position opened 📈
`.trim(),
    [
      [
        { text: "📊 VIEW POSITIONS", callback_data: "positions" }
      ],
      [
        { text: "⚡ TRADE AGAIN", callback_data: "trade" },
        { text: "🏠 HOME", callback_data: "home" }
      ]
    ]
  );
}


// ============================================================
// POSITIONS
// ============================================================

async function showPositions(env, chatId, userId) {
  const rows = await env.DB
    .prepare(`
      SELECT *
      FROM positions
      WHERE user_id = ?
      ORDER BY created_at DESC
    `)
    .bind(userId)
    .all();

  if (!rows.results?.length) {
    return sendMessage(
      env,
      chatId,
      `
📊 <b>POSITIONS</b>

No open positions yet.
`.trim(),
      [
        [
          { text: "⚡ TRADE", callback_data: "trade" }
        ],
        [
          { text: "← Back", callback_data: "home" }
        ]
      ]
    );
  }

  const buttons = [];

  for (const p of rows.results) {
    let market;

    try {
      market = await getTokenData(p.chain, p.ca);
    } catch {
      market = {
        price: Number(p.current_price || 0),
        mcap: p.current_mcap
      };
    }

    const value =
      Number(p.quantity) * Number(market.price || 0);

    const pnl =
      value - Number(p.invested_usd);

    buttons.push([
      {
        text:
          `${pnl >= 0 ? "🟢" : "🔴"} $${p.symbol} ${percent(
            (pnl / Number(p.invested_usd)) * 100
          )}`,
        callback_data: `pos:${p.id}`
      }
    ]);
  }

  buttons.push([
    { text: "← Back", callback_data: "home" }
  ]);

  return sendMessage(
    env,
    chatId,
    "📊 <b>YOUR POSITIONS</b>\n\nSelect a position:",
    buttons
  );
}


async function showPosition(env, chatId, userId, positionId) {
  const p = await env.DB
    .prepare(`
      SELECT *
      FROM positions
      WHERE id = ?
      AND user_id = ?
    `)
    .bind(positionId, userId)
    .first();

  if (!p) {
    return sendMessage(
      env,
      chatId,
      "❌ Position not found.",
      backKeyboard()
    );
  }

  let market;

  try {
    market = await getTokenData(p.chain, p.ca);
  } catch {
    market = {
      price: Number(p.current_price || 0),
      mcap: p.current_mcap
    };
  }

  const value =
    Number(p.quantity) * Number(market.price || 0);

  const pnl =
    value - Number(p.invested_usd);

  const pnlPct =
    Number(p.invested_usd) > 0
      ? (pnl / Number(p.invested_usd)) * 100
      : 0;

  const text = `
🪙 <b>$${esc(p.symbol)}</b>
${esc(p.name)}

${esc(CHAINS[p.chain]?.name || p.chain)}

💵 Entry: <b>${price(p.entry_price)}</b>
💵 Current: <b>${price(market.price)}</b>

💰 Entry MCap: <b>${compactMoney(p.entry_mcap)}</b>
💰 Current MCap: <b>${compactMoney(market.mcap)}</b>

💵 Invested: <b>${money(p.invested_usd)}</b>
📦 Value: <b>${money(value)}</b>

📈 PnL:
<b>${pnl >= 0 ? "+" : ""}${money(pnl)}</b>
(${percent(pnlPct)})

🚀 Multiple: <b>${multiple(market.price, p.entry_price)}</b>
`.trim();

  return sendMessage(
    env,
    chatId,
    text,
    [
      [
        {
          text: "💰 BUY MORE",
          callback_data: `buypos:${p.id}`
        }
      ],
      [
        {
          text: "🔴 SELL",
          callback_data: `sell:${p.id}`
        }
      ],
      [
        {
          text: "← Positions",
          callback_data: "positions"
        }
      ]
    ]
  );
}


// ============================================================
// BUY MORE
// ============================================================

async function askBuyMore(env, chatId, userId, positionId) {
  const p = await env.DB
    .prepare(`
      SELECT *
      FROM positions
      WHERE id = ?
      AND user_id = ?
    `)
    .bind(positionId, userId)
    .first();

  if (!p) return;

  await setSession(
    env,
    userId,
    "buy_more",
    { positionId }
  );

  return sendMessage(
    env,
    chatId,
    `
💰 <b>BUY MORE</b>

$${esc(p.symbol)}

How much do you want to add?
`.trim(),
    [
      [
        { text: "$1", callback_data: "moreamt:1" },
        { text: "$5", callback_data: "moreamt:5" },
        { text: "$10", callback_data: "moreamt:10" }
      ],
      [
        { text: "$25", callback_data: "moreamt:25" },
        { text: "$50", callback_data: "moreamt:50" },
        { text: "Custom", callback_data: "morecustom" }
      ],
      [
        { text: "← Back", callback_data: `pos:${positionId}` }
      ]
    ]
  );
}


async function confirmBuyMore(env, chatId, userId, amount) {
  const session = await getSession(env, userId);

  if (!session) return;

  const data = JSON.parse(session.data || "{}");
  const positionId = Number(data.positionId);

  const p = await env.DB
    .prepare(`
      SELECT *
      FROM positions
      WHERE id = ?
      AND user_id = ?
    `)
    .bind(positionId, userId)
    .first();

  if (!p) return;

  const wallet = await getWallet(env, userId);

  if (amount > Number(wallet.cash_balance)) {
    return sendMessage(
      env,
      chatId,
      `❌ Available: <b>${money(wallet.cash_balance)}</b>`,
      backKeyboard()
    );
  }

  let market;

  try {
    market = await getTokenData(p.chain, p.ca);
  } catch {
    return sendMessage(
      env,
      chatId,
      "❌ Could not refresh price.",
      backKeyboard()
    );
  }

  const qty = amount / market.price;

  await setSession(
    env,
    userId,
    "confirm_more",
    {
      positionId,
      amount
    }
  );

  return sendMessage(
    env,
    chatId,
    `
🟢 <b>CONFIRM BUY MORE</b>

$${esc(p.symbol)}

Current Price: ${price(market.price)}
Current MCap: ${compactMoney(market.mcap)}

Add: <b>${money(amount)}</b>
Tokens: <b>${qty.toLocaleString()}</b>
`.trim(),
    [
      [
        {
          text: "✅ CONFIRM",
          callback_data: "confirmmore"
        }
      ],
      [
        {
          text: "❌ CANCEL",
          callback_data: `pos:${positionId}`
        }
      ]
    ]
  );
}


async function executeBuyMore(env, chatId, userId) {
  const session = await getSession(env, userId);

  if (!session) return;

  const data = JSON.parse(session.data || "{}");

  const positionId = Number(data.positionId);
  const amount = Number(data.amount);

  const p = await env.DB
    .prepare(`
      SELECT *
      FROM positions
      WHERE id = ?
      AND user_id = ?
    `)
    .bind(positionId, userId)
    .first();

  if (!p) return;

  const wallet = await getWallet(env, userId);

  if (amount > Number(wallet.cash_balance)) {
    return sendMessage(
      env,
      chatId,
      "❌ Insufficient paper balance.",
      mainKeyboard()
    );
  }

  const market = await getTokenData(
    p.chain,
    p.ca
  );

  const qty = amount / market.price;

  const oldQty = Number(p.quantity);
  const oldInvested = Number(p.invested_usd);

  const newQty = oldQty + qty;
  const newInvested = oldInvested + amount;

  const newEntryPrice =
    newInvested / newQty;

  const now = Date.now();

  await env.DB
    .prepare(`
      UPDATE positions
      SET
        entry_price = ?,
        current_price = ?,
        current_mcap = ?,
        quantity = ?,
        invested_usd = ?,
        remaining_invested_usd = ?,
        updated_at = ?
      WHERE id = ?
    `)
    .bind(
      newEntryPrice,
      market.price,
      market.mcap || null,
      newQty,
      newInvested,
      newInvested,
      now,
      positionId
    )
    .run();

  await env.DB
    .prepare(`
      UPDATE wallets
      SET cash_balance = cash_balance - ?,
          updated_at = ?
      WHERE user_id = ?
    `)
    .bind(amount, now, userId)
    .run();

  await env.DB
    .prepare(`
      INSERT INTO trades
      (user_id, position_id, chain, ca, name, symbol,
       side, sell_percent, price, mcap, quantity,
       usd_amount, pnl_usd, pnl_percent, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'BUY', NULL, ?, ?, ?, ?, 0, 0, ?)
    `)
    .bind(
      userId,
      positionId,
      p.chain,
      p.ca,
      p.name,
      p.symbol,
      market.price,
      market.mcap || null,
      qty,
      amount,
      now
    )
    .run();

  await clearSession(env, userId);

  return sendMessage(
    env,
    chatId,
    `
✅ <b>BUY MORE COMPLETE</b>

$${esc(p.symbol)}

Added: <b>${money(amount)}</b>
Price: ${price(market.price)}

New position:
${money(newInvested)} invested
${newQty.toLocaleString()} tokens
`.trim(),
    [
      [
        { text: "📊 POSITION", callback_data: `pos:${positionId}` }
      ],
      [
        { text: "🏠 HOME", callback_data: "home" }
      ]
    ]
  );
}


// ============================================================
// SELL
// ============================================================

async function showSellMenu(env, chatId, userId, positionId) {
  const p = await env.DB
    .prepare(`
      SELECT *
      FROM positions
      WHERE id = ?
      AND user_id = ?
    `)
    .bind(positionId, userId)
    .first();

  if (!p) return;

  let market;

  try {
    market = await getTokenData(p.chain, p.ca);
  } catch {
    market = {
      price: Number(p.current_price || 0),
      mcap: p.current_mcap
    };
  }

  const value =
    Number(p.quantity) * Number(market.price);

  const pnl =
    value - Number(p.invested_usd);

  const pnlPct =
    Number(p.invested_usd) > 0
      ? pnl / Number(p.invested_usd) * 100
      : 0;

  const text = `
🔴 <b>SELL $${esc(p.symbol)}</b>

Current Price: ${price(market.price)}
Current MCap: ${compactMoney(market.mcap)}

Position Value: <b>${money(value)}</b>

PnL:
<b>${pnl >= 0 ? "+" : ""}${money(pnl)}</b>
(${percent(pnlPct)})

Multiple: <b>${multiple(
    market.price,
    p.entry_price
  )}</b>
`.trim();

  return sendMessage(
    env,
    chatId,
    text,
    [
      [
        {
          text: "💯 MAX SELL",
          callback_data: `sellconfirm:${p.id}:100`
        }
      ],
      [
        {
          text: "📤 DCA OUT",
          callback_data: `dca:${p.id}`
        }
      ],
      [
        {
          text: "← Back",
          callback_data: `pos:${p.id}`
        }
      ]
    ]
  );
}


async function showDcaMenu(env, chatId, userId, positionId) {
  const p = await env.DB
    .prepare(`
      SELECT *
      FROM positions
      WHERE id = ?
      AND user_id = ?
    `)
    .bind(positionId, userId)
    .first();

  if (!p) return;

  let market;

  try {
    market = await getTokenData(p.chain, p.ca);
  } catch {
    market = {
      price: Number(p.current_price || 0),
      mcap: p.current_mcap
    };
  }

  const x =
    Number(p.entry_price) > 0
      ? Number(market.price) / Number(p.entry_price)
      : 0;

  return sendMessage(
    env,
    chatId,
    `
📤 <b>DCA OUT</b>

$${esc(p.symbol)}

Current: <b>${x.toFixed(2)}x</b>
PnL: <b>${percent(
      ((x - 1) * 100)
    )}</b>

How much do you want to sell?
`.trim(),
    [
      [
        {
          text: "20%",
          callback_data: `sellconfirm:${p.id}:20`
        },
        {
          text: "40%",
          callback_data: `sellconfirm:${p.id}:40`
        }
      ],
      [
        {
          text: "60%",
          callback_data: `sellconfirm:${p.id}:60`
        },
        {
          text: "80%",
          callback_data: `sellconfirm:${p.id}:80`
        }
      ],
      [
        {
          text: "100%",
          callback_data: `sellconfirm:${p.id}:100`
        }
      ],
      [
        {
          text: "← Back",
          callback_data: `sell:${p.id}`
        }
      ]
    ]
  );
}


async function confirmSell(env, chatId, userId, positionId, percentToSell) {
  const p = await env.DB
    .prepare(`
      SELECT *
      FROM positions
      WHERE id = ?
      AND user_id = ?
    `)
    .bind(positionId, userId)
    .first();

  if (!p) return;

  let market;

  try {
    market = await getTokenData(p.chain, p.ca);
  } catch {
    return sendMessage(
      env,
      chatId,
      "❌ Could not refresh token price.",
      backKeyboard()
    );
  }

  const pct = Number(percentToSell) / 100;

  const sellQty =
    Number(p.quantity) * pct;

  const proceeds =
    sellQty * Number(market.price);

  const costBasis =
    Number(p.invested_usd) * pct;

  const pnl =
    proceeds - costBasis;

  await setSession(
    env,
    userId,
    "confirm_sell",
    {
      positionId,
      percent: Number(percentToSell),
      price: market.price,
      mcap: market.mcap
    }
  );

  return sendMessage(
    env,
    chatId,
    `
⚠️ <b>CONFIRM PAPER SELL</b>

$${esc(p.symbol)}

Sell: <b>${percentToSell}%</b>

Price: ${price(market.price)}
MCap: ${compactMoney(market.mcap)}

Value: <b>${money(proceeds)}</b>

Realized PnL:
<b>${pnl >= 0 ? "+" : ""}${money(pnl)}</b>
`.trim(),
    [
      [
        {
          text: "✅ CONFIRM SELL",
          callback_data: "confirmsell"
        }
      ],
      [
        {
          text: "❌ CANCEL",
          callback_data: `pos:${p.id}`
        }
      ]
    ]
  );
}


async function executeSell(env, chatId, userId) {
  const session = await getSession(env, userId);

  if (!session) return;

  const data = JSON.parse(session.data || "{}");

  const positionId = Number(data.positionId);
  const pct = Number(data.percent) / 100;

  const p = await env.DB
    .prepare(`
      SELECT *
      FROM positions
      WHERE id = ?
      AND user_id = ?
    `)
    .bind(positionId, userId)
    .first();

  if (!p) return;

  const market = await getTokenData(
    p.chain,
    p.ca
  );

  const sellQty =
    Number(p.quantity) * pct;

  const proceeds =
    sellQty * Number(market.price);

  const costBasis =
    Number(p.invested_usd) * pct;

  const pnl =
    proceeds - costBasis;

  const pnlPct =
    costBasis > 0
      ? (pnl / costBasis) * 100
      : 0;

  const remainingQty =
    Number(p.quantity) - sellQty;

  const remainingInvested =
    Number(p.invested_usd) - costBasis;

  const now = Date.now();

  if (pct >= 0.999999) {
    await env.DB
      .prepare("DELETE FROM positions WHERE id = ?")
      .bind(positionId)
      .run();
  } else {
    await env.DB
      .prepare(`
        UPDATE positions
        SET
          current_price = ?,
          current_mcap = ?,
          quantity = ?,
          invested_usd = ?,
          remaining_invested_usd = ?,
          updated_at = ?
        WHERE id = ?
      `)
      .bind(
        market.price,
        market.mcap || null,
        remainingQty,
        remainingInvested,
        remainingInvested,
        now,
        positionId
      )
      .run();
  }

  await env.DB
    .prepare(`
      UPDATE wallets
      SET
        cash_balance = cash_balance + ?,
        realized_pnl = realized_pnl + ?,
        updated_at = ?
      WHERE user_id = ?
    `)
    .bind(
      proceeds,
      pnl,
      now,
      userId
    )
    .run();

  await env.DB
    .prepare(`
      INSERT INTO trades
      (user_id, position_id, chain, ca, name, symbol,
       side, sell_percent, price, mcap, quantity,
       usd_amount, pnl_usd, pnl_percent, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'SELL', ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .bind(
      userId,
      positionId,
      p.chain,
      p.ca,
      p.name,
      p.symbol,
      Number(data.percent),
      market.price,
      market.mcap || null,
      sellQty,
      proceeds,
      pnl,
      pnlPct,
      now
    )
    .run();

  await clearSession(env, userId);

  return sendMessage(
    env,
    chatId,
    `
✅ <b>PAPER SELL COMPLETE</b>

$${esc(p.symbol)}

Sold: <b>${data.percent}%</b>
Value: <b>${money(proceeds)}</b>

Realized PnL:
<b>${pnl >= 0 ? "+" : ""}${money(pnl)}</b>
(${percent(pnlPct)})

${pct >= 0.999999
  ? "Position fully closed."
  : "Remaining position is still open."}
`.trim(),
    [
      [
        { text: "📊 POSITIONS", callback_data: "positions" },
        { text: "📜 HISTORY", callback_data: "history" }
      ],
      [
        { text: "🏠 HOME", callback_data: "home" }
      ]
    ]
  );
}


// ============================================================
// WALLET
// ============================================================

async function showWallet(env, chatId, userId) {
  const wallet = await getWallet(env, userId);

  const rows = await env.DB
    .prepare(`
      SELECT *
      FROM positions
      WHERE user_id = ?
    `)
    .bind(userId)
    .all();

  let holdings = 0;
  let unrealized = 0;

  for (const p of rows.results || []) {
    try {
      const market = await getTokenData(
        p.chain,
        p.ca
      );

      const value =
        Number(p.quantity) * market.price;

      holdings += value;
      unrealized +=
        value - Number(p.invested_usd);

    } catch {}
  }

  const cash = Number(wallet.cash_balance);
  const total = cash + holdings;

  const totalPnl =
    Number(wallet.realized_pnl) +
    unrealized;

  return sendMessage(
    env,
    chatId,
    `
💰 <b>PAPER WALLET</b>

💵 Cash
<b>${money(cash)}</b>

📦 Holdings
<b>${money(holdings)}</b>

💼 Portfolio
<b>${money(total)}</b>

📈 Realized PnL
<b>${wallet.realized_pnl >= 0 ? "+" : ""}${money(wallet.realized_pnl)}</b>

📊 Unrealized PnL
<b>${unrealized >= 0 ? "+" : ""}${money(unrealized)}</b>

🔥 Total PnL
<b>${totalPnl >= 0 ? "+" : ""}${money(totalPnl)}</b>

Initial Capital
${money(wallet.starting_balance)}
`.trim(),
    [
      [
        {
          text: "💸 REQUEST FUNDS",
          callback_data: "funds"
        }
      ],
      [
        {
          text: "📊 POSITIONS",
          callback_data: "positions"
        },
        {
          text: "← Back",
          callback_data: "home"
        }
      ]
    ]
  );
}


async function showFunds(env, chatId, userId) {
  await setSession(
    env,
    userId,
    "fund_request",
    {}
  );

  return sendMessage(
    env,
    chatId,
    `
💸 <b>REQUEST PAPER FUNDS</b>

Choose amount:
`.trim(),
    [
      [
        { text: "$10", callback_data: "fund:10" },
        { text: "$25", callback_data: "fund:25" },
        { text: "$50", callback_data: "fund:50" }
      ],
      [
        { text: "$100", callback_data: "fund:100" },
        { text: "$250", callback_data: "fund:250" },
        { text: "Custom", callback_data: "fundcustom" }
      ],
      [
        { text: "← Back", callback_data: "wallet" }
      ]
    ]
  );
}


async function addFunds(env, chatId, userId, amount) {
  const wallet = await getWallet(env, userId);

  const now = Date.now();

  await env.DB
    .prepare(`
      UPDATE wallets
      SET cash_balance = cash_balance + ?,
          updated_at = ?
      WHERE user_id = ?
    `)
    .bind(amount, now, userId)
    .run();

  await env.DB
    .prepare(`
      INSERT INTO fund_requests
      (user_id, amount, status, created_at)
      VALUES (?, ?, 'approved', ?)
    `)
    .bind(
      userId,
      amount,
      now
    )
    .run();

  await clearSession(env, userId);

  return sendMessage(
    env,
    chatId,
    `
💸 <b>PAPER FUNDS ADDED</b>

Added:
<b>${money(amount)}</b>

New Cash Balance:
<b>${money(Number(wallet.cash_balance) + amount)}</b>
`.trim(),
    [
      [
        { text: "💰 WALLET", callback_data: "wallet" }
      ],
      [
        { text: "⚡ TRADE", callback_data: "trade" }
      ]
    ]
  );
}


// ============================================================
// HISTORY
// ============================================================

async function showHistory(env, chatId, userId) {
  const rows = await env.DB
    .prepare(`
      SELECT *
      FROM trades
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT 20
    `)
    .bind(userId)
    .all();

  if (!rows.results?.length) {
    return sendMessage(
      env,
      chatId,
      `
📜 <b>TRADE HISTORY</b>

No trades yet.
`.trim(),
      backKeyboard()
    );
  }

  let text = "📜 <b>TRADE HISTORY</b>\n\n";

  for (const t of rows.results) {
    const icon =
      t.side === "BUY"
        ? "🟢"
        : "🔴";

    const date =
      new Date(t.created_at)
        .toLocaleString("en-US", {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit"
        });

    text +=
      `${icon} <b>${t.side}</b> $${esc(t.symbol)}\n` +
      `💵 ${money(t.usd_amount)} @ ${price(t.price)}\n`;

    if (t.side === "SELL") {
      text +=
        `📈 PnL: ${t.pnl_usd >= 0 ? "+" : ""}${money(t.pnl_usd)} ` +
        `(${percent(t.pnl_percent)})\n`;
    }

    text += `🕐 ${date}\n\n`;
  }

  return sendMessage(
    env,
    chatId,
    text,
    backKeyboard()
  );
}


// ============================================================
// CALLBACK HANDLER
// ============================================================

async function handleCallback(update, env) {
  const query = update.callback_query;

  const tgUser = query.from;
  const chatId =
    query.message?.chat?.id;

  if (!chatId) return;

  const user = await ensureUser(
    env,
    tgUser
  );

  const data =
    query.data || "";

  await answerCallback(
    env,
    query.id
  );

  // HOME
  if (data === "home") {
    await clearSession(env, user.id);
    return showHome(
      env,
      chatId,
      user.id
    );
  }

  // TRADE
  if (data === "trade") {
    await clearSession(env, user.id);
    return showChains(
      env,
      chatId
    );
  }

  // CHAIN
  if (data.startsWith("chain:")) {
    const chain = data.split(":")[1];

    if (!CHAINS[chain]) return;

    return askCA(
      env,
      chatId,
      user.id,
      chain
    );
  }

  // BUY AMOUNT
  if (data.startsWith("buyamt:")) {
    const amount =
      Number(data.split(":")[1]);

    return showBuyConfirm(
      env,
      chatId,
      user.id,
      amount
    );
  }

  // CUSTOM BUY
  if (data === "buycustom") {
    const session =
      await getSession(env, user.id);

    if (!session) return;

    const d =
      JSON.parse(session.data || "{}");

    await setSession(
      env,
      user.id,
      "custom_buy",
      {
        token: d.token
      }
    );

    return sendMessage(
      env,
      chatId,
      "💵 Send the amount in USD.\n\nExample: <code>7.5</code>",
      backKeyboard()
    );
  }

  // CONFIRM BUY
  if (data === "confirmbuy") {
    return executeBuy(
      env,
      chatId,
      user.id
    );
  }

  // POSITIONS
  if (data === "positions") {
    await clearSession(env, user.id);

    return showPositions(
      env,
      chatId,
      user.id
    );
  }

  // POSITION
  if (data.startsWith("pos:")) {
    const positionId =
      Number(data.split(":")[1]);

    return showPosition(
      env,
      chatId,
      user.id,
      positionId
    );
  }

  // BUY MORE
  if (data.startsWith("buypos:")) {
    const positionId =
      Number(data.split(":")[1]);

    return askBuyMore(
      env,
      chatId,
      user.id,
      positionId
    );
  }

  // BUY MORE AMOUNT
  if (data.startsWith("moreamt:")) {
    const amount =
      Number(data.split(":")[1]);

    return confirmBuyMore(
      env,
      chatId,
      user.id,
      amount
    );
  }

  // CUSTOM BUY MORE
  if (data === "morecustom") {
    const session =
      await getSession(env, user.id);

    if (!session) return;

    const d =
      JSON.parse(session.data || "{}");

    await setSession(
      env,
      user.id,
      "custom_more",
      {
        positionId: d.positionId
      }
    );

    return sendMessage(
      env,
      chatId,
      "💵 Send amount in USD.\n\nExample: <code>15</code>",
      backKeyboard()
    );
  }

  // CONFIRM MORE
  if (data === "confirmmore") {
    return executeBuyMore(
      env,
      chatId,
      user.id
    );
  }

  // SELL MENU
  if (data.startsWith("sell:")) {
    const positionId =
      Number(data.split(":")[1]);

    return showSellMenu(
      env,
      chatId,
      user.id,
      positionId
    );
  }

  // DCA
  if (data.startsWith("dca:")) {
    const positionId =
      Number(data.split(":")[1]);

    return showDcaMenu(
      env,
      chatId,
      user.id,
      positionId
    );
  }

  // SELL CONFIRM
  if (data.startsWith("sellconfirm:")) {
    const parts =
      data.split(":");

    const positionId =
      Number(parts[1]);

    const sellPercent =
      Number(parts[2]);

    return confirmSell(
      env,
      chatId,
      user.id,
      positionId,
      sellPercent
    );
  }

  // FINAL SELL
  if (data === "confirmsell") {
    return executeSell(
      env,
      chatId,
      user.id
    );
  }

  // WALLET
  if (data === "wallet") {
    await clearSession(env, user.id);

    return showWallet(
      env,
      chatId,
      user.id
    );
  }

  // FUND REQUEST
  if (data === "funds") {
    return showFunds(
      env,
      chatId,
      user.id
    );
  }

  // FUND AMOUNT
  if (data.startsWith("fund:")) {
    const amount =
      Number(data.split(":")[1]);

    return addFunds(
      env,
      chatId,
      user.id,
      amount
    );
  }

  // CUSTOM FUND
  if (data === "fundcustom") {
    await setSession(
      env,
      user.id,
      "custom_fund",
      {}
    );

    return sendMessage(
      env,
      chatId,
      "💵 Send the amount you want to request.\n\nExample: <code>100</code>",
      backKeyboard()
    );
  }

  // HISTORY
  if (data === "history") {
    await clearSession(env, user.id);

    return showHistory(
      env,
      chatId,
      user.id
    );
  }
}


// ============================================================
// MESSAGE HANDLER
// ============================================================

async function handleMessage(update, env) {
  const message = update.message;

  if (!message?.chat?.id) return;

  const chatId = message.chat.id;
  const tgUser = message.from;

  // Only private chat
  if (message.chat.type !== "private") {
    return;
  }

  const user =
    await ensureUser(
      env,
      tgUser
    );

  const text =
    (message.text || "").trim();

  // START
  if (
    text === "/start" ||
    text === "/menu"
  ) {
    await clearSession(
      env,
      user.id
    );

    return showHome(
      env,
      chatId,
      user.id
    );
  }

  const session =
    await getSession(
      env,
      user.id
    );

  if (!session) {
    return showHome(
      env,
      chatId,
      user.id
    );
  }

  const data =
    JSON.parse(session.data || "{}");

  // CA
  if (session.state === "awaiting_ca") {
    const chain =
      data.chain;

    try {
      const token =
        await getTokenData(
          chain,
          text
        );

      return showToken(
        env,
        chatId,
        user.id,
        token
      );

    } catch (error) {
      return sendMessage(
        env,
        chatId,
        `
❌ <b>Token not found</b>

Check the CA and selected chain, then try again.
`.trim(),
        backKeyboard()
      );
    }
  }

  // CUSTOM BUY
  if (session.state === "custom_buy") {
    const amount =
      Number(text);

    if (!Number.isFinite(amount) || amount <= 0) {
      return sendMessage(
        env,
        chatId,
        "❌ Enter a valid USD amount.",
        backKeyboard()
      );
    }

    await setSession(
      env,
      user.id,
      "awaiting_amount",
      {
        token: data.token
      }
    );

    return showBuyConfirm(
      env,
      chatId,
      user.id,
      amount
    );
  }

  // CUSTOM BUY MORE
  if (session.state === "custom_more") {
    const amount =
      Number(text);

    if (!Number.isFinite(amount) || amount <= 0) {
      return sendMessage(
        env,
        chatId,
        "❌ Enter a valid USD amount.",
        backKeyboard()
      );
    }

    await setSession(
      env,
      user.id,
      "buy_more",
      {
        positionId: data.positionId
      }
    );

    return confirmBuyMore(
      env,
      chatId,
      user.id,
      amount
    );
  }

  // CUSTOM FUND
  if (session.state === "custom_fund") {
    const amount =
      Number(text);

    if (!Number.isFinite(amount) || amount <= 0) {
      return sendMessage(
        env,
        chatId,
        "❌ Enter a valid amount.",
        backKeyboard()
      );
    }

    return addFunds(
      env,
      chatId,
      user.id,
      amount
    );
  }

  return sendMessage(
    env,
    chatId,
    "Use /start to open the paper trader.",
    mainKeyboard()
  );
}


// ============================================================
// UPDATE ROUTER
// ============================================================

async function handleUpdate(update, env) {
  if (update.callback_query) {
    return handleCallback(
      update,
      env
    );
  }

  if (update.message) {
    return handleMessage(
      update,
      env
    );
  }
}