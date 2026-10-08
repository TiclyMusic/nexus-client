package online.nexusmc.companion;

import com.mojang.blaze3d.platform.InputConstants;
import java.util.ArrayList;
import java.util.List;
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.fabricmc.fabric.api.client.keybinding.v1.KeyBindingHelper;
import net.fabricmc.fabric.api.client.screen.v1.ScreenEvents;
import net.fabricmc.fabric.api.client.screen.v1.Screens;
import net.minecraft.client.KeyMapping;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.components.AbstractWidget;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.gui.screens.PauseScreen;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.gui.screens.TitleScreen;
import net.minecraft.network.chat.Component;

/**
 * Nexus Companion: menu amici in gioco (tasto G), pannello amici nel menu di pausa e nella
 * schermata iniziale, avvisi per richieste / inviti / messaggi.
 */
public class NexusClient implements ClientModInitializer {
	private static final KeyMapping.Category CATEGORY = KeyMapping.Category.MULTIPLAYER;
	public static KeyMapping friendsKey;
	private static final int PANEL_W = 128;
	/** Larghezza del menu centrale di Minecraft (pausa e schermata iniziale). */
	private static final int MENU_W = 210;
	private static final int PANEL_ROWS = 6;

	@Override
	public void onInitializeClient() {
		if (SelfTest.enabled()) SelfTest.seed();
		else Bridge.start();
		friendsKey = KeyBindingHelper.registerKeyBinding(new KeyMapping("key.nexus.friends", InputConstants.KEY_G, CATEGORY));

		ClientTickEvents.END_CLIENT_TICK.register(mc -> {
			Social.tick(mc);
			if (SelfTest.enabled()) SelfTest.tick(mc);
			while (friendsKey.consumeClick()) {
				if (mc.screen == null) mc.setScreen(new FriendsScreen(null));
			}
		});

		ScreenEvents.AFTER_INIT.register((mc, screen, width, height) -> {
			boolean pause = screen instanceof PauseScreen p && p.showsPauseMenu();
			if (!pause && !(screen instanceof TitleScreen)) return;
			decorate(mc, screen, width, height);
		});
	}

	public static String friendsKeyName() {
		return friendsKey == null ? "G" : friendsKey.getTranslatedKeyMessage().getString().toUpperCase();
	}

	/** Pannello amici sul lato destro del menu di pausa / schermata iniziale. */
	private static void decorate(Minecraft mc, Screen screen, int width, int height) {
		List<AbstractWidget> widgets = Screens.getButtons(screen);
		int count = Social.requests.size();
		String label = count > 0 ? "Amici (" + count + ")" : "Amici";
		// poco spazio accanto al menu: solo un pulsante in alto a destra
		if ((width - MENU_W) / 2 < PANEL_W + 12) {
			widgets.add(Button.builder(Component.literal(label + "  [" + friendsKeyName() + "]"), btn -> mc.setScreen(new FriendsScreen(screen)))
				.bounds(width - 92, 6, 86, 20).build());
			return;
		}
		int x = width - PANEL_W - 8;
		int y = Math.max(8, height / 4 + 8);
		List<Bridge.Friend> shown = panelFriends();

		int rowY = y + 30;
		for (Bridge.Friend f : shown) {
			Button b = null;
			if (f.joinable() && Social.sameVersion(f)) {
				b = Button.builder(Component.literal("Entra"), btn -> Social.join(mc, f)).bounds(x + PANEL_W - 44, rowY + 3, 38, 16).build();
			} else if (Social.inSingleplayer()) {
				b = Button.builder(Component.literal("Invita"), btn -> Social.invite(mc, f)).bounds(x + PANEL_W - 44, rowY + 3, 38, 16).build();
			}
			if (b != null) widgets.add(b);
			rowY += 22;
		}
		widgets.add(Button.builder(Component.literal((count > 0 ? label : "Tutti gli amici") + "  [" + friendsKeyName() + "]"), btn -> mc.setScreen(new FriendsScreen(screen)))
			.bounds(x + 6, rowY + 4, PANEL_W - 12, 18).build());

		final int panelH = rowY + 28 - y;
		ScreenEvents.afterBackground(screen).register((s, g, mouseX, mouseY, a) -> drawPanel(s, g, x, y, panelH, shown));
	}

	private static List<Bridge.Friend> panelFriends() {
		List<Bridge.Friend> online = new ArrayList<>();
		for (Bridge.Friend f : Bridge.friends) if (f.online()) online.add(f);
		online.sort((a, b) -> Boolean.compare(b.joinable(), a.joinable()));
		return online.subList(0, Math.min(PANEL_ROWS, online.size()));
	}

	private static void drawPanel(Screen s, GuiGraphics g, int x, int y, int h, List<Bridge.Friend> shown) {
		var font = Minecraft.getInstance().font;
		Ui.panel(g, x, y, PANEL_W, h, 6, Ui.SURFACE);
		long online = Bridge.friends.stream().filter(Bridge.Friend::online).count();
		g.drawString(font, "Amici", x + 8, y + 8, Ui.TEXT, false);
		String count = Bridge.connected ? online + " online" : "offline";
		g.drawString(font, count, x + PANEL_W - 8 - font.width(count), y + 8, Ui.PRIMARY, false);
		g.fill(x + 8, y + 21, x + PANEL_W - 8, y + 22, Ui.OUTLINE);
		int rowY = y + 30;
		if (shown.isEmpty()) {
			g.drawString(font, Bridge.connected ? "Nessun amico online" : "Apri Nexus Launcher", x + 8, rowY + 6, Ui.MUTED, false);
		}
		for (Bridge.Friend f : shown) {
			Ui.face(g, f.uuid(), x + 8, rowY + 3, 16);
			Ui.dot(g, x + 20, rowY + 15, Ui.statusColor(f));
			int textW = PANEL_W - 78;
			g.drawString(font, Ui.fit(font, f.name(), textW), x + 30, rowY + 2, Ui.TEXT, false);
			g.drawString(font, Ui.fit(font, Ui.statusText(f), textW), x + 30, rowY + 12, Ui.statusColor(f), false);
			rowY += 22;
		}
	}
}
