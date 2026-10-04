// @ts-nocheck

export default {
  async fetch(request, env) {
    return Response.json({
      ok: true,
      bot: "Degen Paper Trader",
      status: "online",
      version: "1.0.0"
    });
  }
};