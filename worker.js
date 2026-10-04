// @ts-nocheck

export default {
  async fetch(request, env) {
    try {
      const result = await env.DB
        .prepare("SELECT COUNT(*) AS count FROM users")
        .first();

      return Response.json({
        ok: true,
        bot: "Degen Paper Trader",
        database: true,
        users: result?.count ?? 0
      });

    } catch (error) {
      return Response.json({
        ok: false,
        database: false,
        error: error.message
      }, { status: 500 });
    }
  }
};