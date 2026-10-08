package online.nexusmc.companion;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.gui.components.Tooltip;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.input.KeyEvent;
import net.minecraft.network.chat.Component;
import org.jspecify.annotations.Nullable;

/** Menu amici in gioco (tasto G): richieste, amici con Entra / Invita / Chiedi di entrare. */
public final class FriendsScreen extends Screen {
	private static final int ROW_H = 30;
	private final @Nullable Screen parent;
	private int scroll;
	private String signature = "";
	private int px, py, pw, ph, listTop, listBottom;

	public FriendsScreen(@Nullable Screen parent) {
		super(Component.literal("Amici"));
		this.parent = parent;
	}

	@Override
	protected void init() {
		pw = Math.min(380, width - 32);
		ph = height - 40;
		px = (width - pw) / 2;
		py = 20;
		listTop = py + 40;
		listBottom = py + ph - 34;
		signature = signature();

		int y = listTop - scroll;
		for (Social.Request r : List.copyOf(Social.requests)) {
			if (y >= listTop && y + ROW_H <= listBottom) {
				if (r.kind().equals("join")) {
					addRenderableWidget(Button.builder(Component.literal("Fai entrare"), b -> { Social.accept(minecraft, r); rebuildWidgets(); })
						.bounds(px + pw - 132, y + 5, 80, 20).build());
				} else {
					Bridge.Friend host = friend(r.uuid());
					Button enter = Button.builder(Component.literal("Entra"), b -> { if (host != null) Social.join(minecraft, host); })
						.bounds(px + pw - 132, y + 5, 80, 20).build();
					enter.active = host != null && host.joinable();
					if (!enter.active) enter.setTooltip(Tooltip.create(Component.literal("Il mondo si sta aprendo…")));
					addRenderableWidget(enter);
				}
				addRenderableWidget(Button.builder(Component.literal("✕"), b -> { Social.requests.remove(r); rebuildWidgets(); })
					.bounds(px + pw - 48, y + 5, 20, 20).tooltip(Tooltip.create(Component.literal("Ignora"))).build());
			}
			y += ROW_H;
		}

		for (Bridge.Friend f : sortedFriends()) {
			if (y >= listTop && y + ROW_H <= listBottom) {
				Button action = actionFor(f, px + pw - 92, y + 5);
				if (action != null) addRenderableWidget(action);
			}
			y += ROW_H;
		}

		int bw = (pw - 24) / 2;
		if (Social.inSingleplayer()) {
			boolean open = minecraft.getSingleplayerServer() != null && minecraft.getSingleplayerServer().isPublished();
			Button share = Button.builder(Component.literal(open ? "✔ Mondo aperto agli amici" : "Apri il mondo agli amici"), b -> {
				Social.openToFriends(minecraft);
				rebuildWidgets();
			}).bounds(px + 8, py + ph - 28, bw, 20).build();
			share.active = !open;
			addRenderableWidget(share);
		}
		addRenderableWidget(Button.builder(Component.literal("Fatto"), b -> onClose()).bounds(px + pw - 8 - bw, py + ph - 28, bw, 20).build());
	}

	private @Nullable Button actionFor(Bridge.Friend f, int x, int y) {
		if (!f.online()) return null;
		if (f.joinable()) {
			Button b = Button.builder(Component.literal("Entra"), btn -> Social.join(minecraft, f)).bounds(x, y, 84, 20).build();
			if (!Social.sameVersion(f)) {
				b.active = false;
				b.setTooltip(Tooltip.create(Component.literal("Serve Minecraft " + f.mcVersion() + " (tu hai " + Social.gameVersion() + ")")));
			}
			return b;
		}
		if (Social.inSingleplayer()) {
			return Button.builder(Component.literal("Invita"), btn -> { Social.invite(minecraft, f); rebuildWidgets(); }).bounds(x, y, 84, 20).build();
		}
		if ("playing".equals(f.status())) {
			boolean pending = Social.isPending(f.uuid());
			Button b = Button.builder(Component.literal(pending ? "In attesa…" : "Chiedi"), btn -> { Social.askToJoin(f); rebuildWidgets(); })
				.bounds(x, y, 84, 20)
				.tooltip(Tooltip.create(Component.literal("Chiedi a " + f.name() + " di farti entrare nel suo mondo")))
				.build();
			b.active = !pending;
			return b;
		}
		return null;
	}

	private static Bridge.@Nullable Friend friend(String uuid) {
		for (Bridge.Friend f : Bridge.friends) if (f.uuid().equals(uuid)) return f;
		return null;
	}

	private static List<Bridge.Friend> sortedFriends() {
		List<Bridge.Friend> list = new ArrayList<>(Bridge.friends);
		list.sort(Comparator.comparing((Bridge.Friend f) -> !f.online()).thenComparing(f -> !f.joinable()).thenComparing(f -> f.name().toLowerCase()));
		return list;
	}

	private static String signature() {
		StringBuilder sb = new StringBuilder();
		for (Bridge.Friend f : Bridge.friends) sb.append(f.uuid()).append(f.online()).append(f.status()).append(f.joinAddress()).append(';');
		for (Social.Request r : Social.requests) sb.append(r.kind()).append(r.uuid()).append(';');
		return sb.toString();
	}

	@Override
	public void tick() {
		// nuovi dati dal launcher: ricostruisci pulsanti e righe
		if (!signature.equals(signature())) rebuildWidgets();
	}

	@Override
	public boolean mouseScrolled(double x, double y, double scrollX, double scrollY) {
		int rows = Social.requests.size() + Bridge.friends.size();
		int max = Math.max(0, rows * ROW_H - (listBottom - listTop));
		int next = Math.max(0, Math.min(max, scroll - (int) (scrollY * ROW_H)));
		if (next != scroll) {
			scroll = next;
			rebuildWidgets();
		}
		return true;
	}

	@Override
	public boolean keyPressed(KeyEvent event) {
		if (NexusClient.friendsKey.matches(event)) {
			onClose();
			return true;
		}
		return super.keyPressed(event);
	}

	@Override
	public void onClose() {
		minecraft.setScreen(parent);
	}

	@Override
	public void extractRenderState(GuiGraphicsExtractor g, int mouseX, int mouseY, float a) {
		Ui.panel(g, px, py, pw, ph, 8, Ui.SURFACE);
		long online = Bridge.friends.stream().filter(Bridge.Friend::online).count();
		g.text(font, "Amici", px + 14, py + 12, Ui.TEXT, false);
		String sub = !Bridge.connected ? "Nexus Launcher non collegato" : online + " online · " + Bridge.friends.size() + " amici";
		g.text(font, sub, px + 14, py + 24, Ui.MUTED, false);
		String brand = "NEXUS";
		g.text(font, brand, px + pw - 14 - font.width(brand), py + 12, Ui.PRIMARY, false);

		g.enableScissor(px, listTop, px + pw, listBottom);
		int y = listTop - scroll;
		for (Social.Request r : List.copyOf(Social.requests)) {
			Ui.panel(g, px + 8, y + 1, pw - 16, ROW_H - 2, 5, 0x3A8BD88E);
			Ui.face(g, r.uuid(), px + 16, y + 7, 16);
			String title = r.kind().equals("join") ? r.name() + " vuole entrare" : r.name() + " ti invita";
			g.text(font, Ui.fit(font, title, pw - 190), px + 40, y + 6, Ui.TEXT, false);
			String hint = r.kind().equals("join") ? (Social.inSingleplayer() ? "Apre il mondo agli amici" : "Entra in un mondo prima") : "Nel suo mondo";
			g.text(font, Ui.fit(font, hint, pw - 190), px + 40, y + 17, Ui.MUTED, false);
			y += ROW_H;
		}
		List<Bridge.Friend> friends = sortedFriends();
		if (friends.isEmpty()) {
			g.centeredText(font, Bridge.connected ? "Nessun amico: aggiungili dal launcher" : "Apri Nexus Launcher per vedere gli amici", px + pw / 2, y + 12, Ui.MUTED);
		}
		for (Bridge.Friend f : friends) {
			if (f.joinable()) Ui.panel(g, px + 8, y + 1, pw - 16, ROW_H - 2, 5, 0x1AFFFFFF);
			Ui.face(g, f.uuid(), px + 16, y + 7, 16);
			Ui.dot(g, px + 29, y + 20, Ui.statusColor(f));
			g.text(font, Ui.fit(font, f.name(), pw - 150), px + 40, y + 6, f.online() ? Ui.TEXT : Ui.MUTED, false);
			g.text(font, Ui.fit(font, Ui.statusText(f), pw - 150), px + 40, y + 17, f.online() ? Ui.statusColor(f) : Ui.OFFLINE, false);
			y += ROW_H;
		}
		g.disableScissor();
		super.extractRenderState(g, mouseX, mouseY, a);
	}
}
