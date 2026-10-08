package online.nexusmc.companion;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import net.minecraft.SharedConstants;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.screens.ConnectScreen;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.gui.screens.TitleScreen;
import net.minecraft.client.multiplayer.ServerData;
import net.minecraft.client.multiplayer.resolver.ServerAddress;
import net.minecraft.client.server.IntegratedServer;
import net.minecraft.network.chat.Component;
import net.minecraft.util.HttpUtil;

/** Azioni sociali in gioco: entrare, invitare, accettare, aprire il mondo agli amici. */
public final class Social {
	/** Richiesta ricevuta: qualcuno vuole entrare (join) o ti invita (invite). */
	public record Request(String kind, String uuid, String name, long at) {}

	private static final long REQUEST_TTL = 5 * 60_000;
	public static final List<Request> requests = new ArrayList<>();
	/** Amici a cui abbiamo chiesto di entrare: entriamo appena aprono il mondo. */
	private static final Map<String, Long> pendingJoins = new HashMap<>();

	private Social() {}

	public static String gameVersion() {
		return SharedConstants.getCurrentVersion().name();
	}

	public static boolean sameVersion(Bridge.Friend f) {
		return f.mcVersion() == null || f.mcVersion().isEmpty() || f.mcVersion().equals(gameVersion());
	}

	public static boolean inSingleplayer() {
		return Minecraft.getInstance().getSingleplayerServer() != null;
	}

	public static boolean isPending(String uuid) {
		Long at = pendingJoins.get(uuid);
		return at != null && System.currentTimeMillis() - at < REQUEST_TTL;
	}

	/** Chiamata a ogni tick del client (thread principale). */
	static void tick(Minecraft mc) {
		Bridge.Event event;
		while ((event = Bridge.events.poll()) != null) handle(mc, event);

		long now = System.currentTimeMillis();
		requests.removeIf(r -> now - r.at() > REQUEST_TTL);
		pendingJoins.values().removeIf(at -> now - at > REQUEST_TTL);
		if (!pendingJoins.isEmpty()) {
			for (Bridge.Friend f : Bridge.friends) {
				if (pendingJoins.containsKey(f.uuid()) && f.joinable()) {
					pendingJoins.remove(f.uuid());
					NexusToast.show(f.uuid(), f.name() + " ha aperto il mondo", "Stai entrando…");
					join(mc, f);
					break;
				}
			}
		}
	}

	private static void handle(Minecraft mc, Bridge.Event e) {
		String key = NexusClient.friendsKeyName();
		switch (e.kind()) {
			case "join" -> {
				requests.removeIf(r -> r.uuid().equals(e.from()) && r.kind().equals("join"));
				requests.add(new Request("join", e.from(), e.name(), System.currentTimeMillis()));
				NexusToast.show(e.from(), e.name() + " vuole entrare", "Premi " + key + " per farlo entrare");
			}
			case "invite" -> {
				requests.removeIf(r -> r.uuid().equals(e.from()) && r.kind().equals("invite"));
				requests.add(new Request("invite", e.from(), e.name(), System.currentTimeMillis()));
				NexusToast.show(e.from(), e.name() + " ti invita", "Premi " + key + " per entrare");
			}
			case "direct" -> NexusToast.show(e.from(), e.name(), e.text());
			case "group" -> NexusToast.show(e.from(), e.name() + " · " + e.groupName(), e.text());
			default -> {}
		}
	}

	/** Entra nel mondo o nel server dell'amico. */
	public static void join(Minecraft mc, Bridge.Friend f) {
		if (!f.joinable()) return;
		requests.removeIf(r -> r.uuid().equals(f.uuid()));
		Screen parent = new TitleScreen();
		ServerData data = new ServerData(f.name(), f.joinAddress(), ServerData.Type.OTHER);
		ConnectScreen.startConnecting(parent, mc, ServerAddress.parseString(f.joinAddress()), data, false, null);
	}

	/** Chiede all'amico (in singleplayer) di farti entrare. */
	public static void askToJoin(Bridge.Friend f) {
		pendingJoins.put(f.uuid(), System.currentTimeMillis());
		Bridge.post("/join-request", Map.of("uuid", f.uuid())).thenAccept(err -> {
			if (err != null) {
				pendingJoins.remove(f.uuid());
				NexusToast.show(f.uuid(), "Richiesta non inviata", err);
			} else {
				NexusToast.show(f.uuid(), "Richiesta inviata a " + f.name(), "Entri appena ti fa entrare");
			}
		});
	}

	/** Apre il mondo singleplayer agli amici (il launcher apre il tunnel da solo). */
	public static boolean openToFriends(Minecraft mc) {
		IntegratedServer server = mc.getSingleplayerServer();
		if (server == null) return false;
		if (server.isPublished()) return true;
		boolean ok = server.publishServer(null, false, HttpUtil.getAvailablePort());
		if (ok) mc.gui.getChat().addMessage(Component.literal("§a[Nexus]§r Il mondo è aperto: i tuoi amici possono entrare."));
		return ok;
	}

	/** Accetta una richiesta di entrare: apre il mondo, l'amico entra da solo. */
	public static void accept(Minecraft mc, Request r) {
		requests.remove(r);
		if (!inSingleplayer()) {
			NexusToast.show(r.uuid(), "Entra in un mondo", "Apri un mondo singleplayer per far entrare " + r.name());
			return;
		}
		if (openToFriends(mc)) NexusToast.show(r.uuid(), r.name() + " sta entrando", "Il mondo è aperto agli amici");
	}

	/** Invita un amico nel tuo mondo (lo apre agli amici se serve). */
	public static void invite(Minecraft mc, Bridge.Friend f) {
		if (!openToFriends(mc)) return;
		Bridge.post("/invite", Map.of("uuid", f.uuid())).thenAccept(err ->
			NexusToast.show(f.uuid(), err == null ? "Invito inviato a " + f.name() : "Invito non inviato", err == null ? "Entrerà con un clic" : err));
	}

	public static UUID uuid(String raw) {
		try {
			String s = raw.replace("-", "");
			if (s.length() != 32) return null;
			return UUID.fromString(s.replaceFirst("(.{8})(.{4})(.{4})(.{4})(.{12})", "$1-$2-$3-$4-$5"));
		} catch (Exception e) {
			return null;
		}
	}
}
