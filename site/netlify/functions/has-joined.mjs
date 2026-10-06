// Inoltra la verifica `hasJoined` al session server di Mojang.
//
// Il server amici (Cloudflare Worker, server/src/index.js) non può chiamarlo direttamente:
// Mojang risponde 403 alle richieste che arrivano da Cloudflare Workers. Questa funzione gira su
// Netlify, che Mojang non blocca, e restituisce la risposta così com'è.
// GET /.netlify/functions/has-joined?username=<nome>&serverId=<id>

const USERNAME = /^[A-Za-z0-9_]{1,16}$/;
const SERVER_ID = /^-?[A-Za-z0-9]{1,64}$/;

export default async (req) => {
  const url = new URL(req.url);
  const username = url.searchParams.get("username") || "";
  const serverId = url.searchParams.get("serverId") || "";
  if (!USERNAME.test(username) || !SERVER_ID.test(serverId)) {
    return Response.json({ error: "Parametri non validi" }, { status: 400 });
  }

  const upstream = await fetch(
    `https://sessionserver.mojang.com/session/minecraft/hasJoined?username=${encodeURIComponent(username)}&serverId=${encodeURIComponent(serverId)}`,
    { headers: { "user-agent": "NexusLauncher-Social/1.0 (+https://nexusmc.online)" } },
  );
  const body = upstream.status === 200 ? await upstream.text() : "";
  return new Response(body || null, {
    status: upstream.status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
};
