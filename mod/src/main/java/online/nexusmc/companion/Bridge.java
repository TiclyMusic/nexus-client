package online.nexusmc.companion;

import com.google.gson.Gson;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentLinkedQueue;

/**
 * Collegamento con Nexus Launcher: porta e token arrivano da {@code -Dnexus.bridge=porta:token}.
 * Un thread in background legge amici ed eventi ogni pochi secondi; le azioni (richiesta di
 * entrare, invito, messaggio) passano dal launcher, che ha la sessione del server amici.
 */
public final class Bridge {
	public record Friend(String uuid, String name, boolean online, String status, String detail, String joinAddress, String mcVersion) {
		public boolean joinable() {
			return online && joinAddress != null && !joinAddress.isEmpty();
		}
	}

	/** Evento dal launcher: kind = join | invite | direct | group. */
	public record Event(String kind, String from, String name, String text, String groupName) {}

	private static final Gson GSON = new Gson();
	private static final HttpClient HTTP = HttpClient.newBuilder().version(HttpClient.Version.HTTP_1_1).connectTimeout(Duration.ofSeconds(3)).build();
	private static String base;
	private static String token;
	private static long seq = -1;

	public static volatile List<Friend> friends = List.of();
	/** Indirizzo pubblico del mondo che stai ospitando (null se non è aperto agli amici). */
	public static volatile String hosting;
	public static volatile boolean connected;
	public static final ConcurrentLinkedQueue<Event> events = new ConcurrentLinkedQueue<>();

	private Bridge() {}

	public static boolean available() {
		return base != null;
	}

	static void start() {
		String prop = System.getProperty("nexus.bridge", "");
		int colon = prop.indexOf(':');
		if (colon <= 0) return;
		base = "http://127.0.0.1:" + prop.substring(0, colon);
		token = prop.substring(colon + 1);
		Thread thread = new Thread(Bridge::loop, "Nexus Bridge");
		thread.setDaemon(true);
		thread.start();
	}

	private static void loop() {
		while (true) {
			try {
				poll();
				connected = true;
			} catch (Exception e) {
				connected = false;
			}
			try {
				Thread.sleep(3000);
			} catch (InterruptedException e) {
				return;
			}
		}
	}

	private static void poll() throws Exception {
		HttpRequest request = HttpRequest.newBuilder(URI.create(base + "/state?since=" + Math.max(seq, 0)))
			.header("x-nexus-token", token)
			.timeout(Duration.ofSeconds(15))
			.GET()
			.build();
		HttpResponse<String> response = HTTP.send(request, HttpResponse.BodyHandlers.ofString());
		if (response.statusCode() != 200) throw new IllegalStateException("HTTP " + response.statusCode());
		JsonObject state = JsonParser.parseString(response.body()).getAsJsonObject();

		List<Friend> list = new ArrayList<>();
		for (JsonElement el : state.getAsJsonArray("friends")) {
			JsonObject f = el.getAsJsonObject();
			list.add(new Friend(str(f, "uuid"), str(f, "name"), f.has("online") && f.get("online").getAsBoolean(), str(f, "status"),
				str(f, "detail"), str(f, "joinAddress"), str(f, "mcVersion")));
		}
		friends = List.copyOf(list);
		hosting = state.has("hosting") && !state.get("hosting").isJsonNull() ? state.get("hosting").getAsString() : null;

		long latest = state.get("seq").getAsLong();
		// al primo collegamento non riproponiamo gli eventi vecchi
		if (seq >= 0) {
			JsonArray incoming = state.getAsJsonArray("events");
			for (JsonElement el : incoming) {
				JsonObject e = el.getAsJsonObject();
				events.add(new Event(str(e, "kind"), str(e, "from"), str(e, "name"), str(e, "text"), str(e, "groupName")));
			}
		}
		seq = latest;
	}

	private static String str(JsonObject o, String key) {
		JsonElement v = o.get(key);
		return v == null || v.isJsonNull() ? "" : v.getAsString();
	}

	/** Azione verso il launcher; il risultato è l'eventuale messaggio di errore (null se ok). */
	public static CompletableFuture<String> post(String path, Map<String, String> body) {
		if (base == null) return CompletableFuture.completedFuture("Nexus Launcher non collegato");
		HttpRequest request = HttpRequest.newBuilder(URI.create(base + path))
			.header("x-nexus-token", token)
			.header("content-type", "application/json")
			.timeout(Duration.ofSeconds(15))
			.POST(HttpRequest.BodyPublishers.ofString(GSON.toJson(body)))
			.build();
		return HTTP.sendAsync(request, HttpResponse.BodyHandlers.ofString()).handle((r, err) -> {
			if (err != null) return "Nexus Launcher non raggiungibile";
			if (r.statusCode() == 200) return null;
			try {
				return JsonParser.parseString(r.body()).getAsJsonObject().get("error").getAsString();
			} catch (Exception e) {
				return "Errore " + r.statusCode();
			}
		});
	}
}
