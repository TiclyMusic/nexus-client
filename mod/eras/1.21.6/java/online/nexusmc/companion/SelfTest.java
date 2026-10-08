package online.nexusmc.companion;

import java.util.List;
import net.minecraft.client.Minecraft;
import net.minecraft.client.Screenshot;
import net.minecraft.client.gui.screens.TitleScreen;

/**
 * Solo sviluppo ({@code -Dnexus.selftest=true}, es. {@code gradlew runClient}): dati finti e
 * screenshot automatici della schermata iniziale e del menu amici, per controllare la grafica.
 */
final class SelfTest {
	private static int ticks;
	private static int step;

	private SelfTest() {}

	static boolean enabled() {
		return Boolean.getBoolean("nexus.selftest");
	}

	static void seed() {
		Bridge.connected = true;
		Bridge.friends = List.of(
			new Bridge.Friend("ec561538f3fd461daff5086b22154bce", "Alex", true, "hosting", "Ha aperto un mondo · Survival", "bore.pub:38421", Social.gameVersion()),
			new Bridge.Friend("8667ba71b85a4004af54457a9734eed7", "Steve", true, "playing", "In singleplayer · Creativa · 26.3", "", Social.gameVersion()),
			new Bridge.Friend("069a79f444e94726a5befca90e38aaf5", "Notch", true, "server", "Su mc.hypixel.net · 26.3", "mc.hypixel.net", Social.gameVersion()),
			new Bridge.Friend("853c80ef3c3749fdaa49938b674adae6", "jeb_", false, "offline", "", "", ""));
		Social.requests.add(new Social.Request("join", "61699b2ed3274a019f1e0ea8c3f06bc6", "Herobrine", System.currentTimeMillis()));
	}

	static void tick(Minecraft mc) {
		if (!(mc.screen instanceof TitleScreen) && step == 0) return;
		ticks++;
		if (step == 0 && ticks == 100) {
			NexusToast.show("ec561538f3fd461daff5086b22154bce", "Alex ti invita", "Premi G per entrare");
		} else if (step == 0 && ticks == 140) {
			shot(mc, "nexus-title.png");
			mc.setScreen(new FriendsScreen(mc.screen));
			step = 1;
			ticks = 0;
		} else if (step == 1 && ticks == 60) {
			shot(mc, "nexus-friends.png");
			step = 2;
		}
	}

	private static void shot(Minecraft mc, String name) {
		Screenshot.grab(mc.gameDirectory, name, mc.getMainRenderTarget(), 1, c -> System.out.println("[Nexus selftest] " + c.getString()));
	}
}
