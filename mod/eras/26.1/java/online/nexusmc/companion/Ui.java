package online.nexusmc.companion;

import java.util.UUID;
import net.minecraft.client.gui.Font;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.components.PlayerFaceExtractor;
import net.minecraft.world.item.component.ResolvableProfile;

/** Disegno condiviso: pannelli arrotondati in stile Nexus (Material 3 scuro), teste e testi. */
public final class Ui {
	public static final int SURFACE = 0xE6141A14;
	public static final int SURFACE_HIGH = 0xF0202820;
	public static final int ROW = 0x40FFFFFF;
	public static final int OUTLINE = 0x33FFFFFF;
	public static final int PRIMARY = 0xFF8BD88E;
	public static final int TEXT = 0xFFE0E4DC;
	public static final int MUTED = 0xFFA6AEA2;
	public static final int ONLINE = 0xFF8BD88E;
	public static final int PLAYING = 0xFFB8CCB4;
	public static final int OFFLINE = 0xFF6B7368;

	private Ui() {}

	/** Rettangolo con angoli arrotondati (raggio r in pixel della GUI). */
	public static void panel(GuiGraphicsExtractor g, int x, int y, int w, int h, int r, int color) {
		g.fill(x + r, y, x + w - r, y + h, color);
		g.fill(x, y + r, x + r, y + h - r, color);
		g.fill(x + w - r, y + r, x + w, y + h - r, color);
		// angoli: righe sempre più corte verso il bordo
		for (int i = 0; i < r; i++) {
			int inset = r - (int) Math.round(Math.sqrt(r * r - (r - i - 0.5) * (r - i - 0.5)));
			g.fill(x + inset, y + i, x + r, y + i + 1, color);
			g.fill(x + w - r, y + i, x + w - inset, y + i + 1, color);
			g.fill(x + inset, y + h - i - 1, x + r, y + h - i, color);
			g.fill(x + w - r, y + h - i - 1, x + w - inset, y + h - i, color);
		}
	}

	public static void face(GuiGraphicsExtractor g, String uuid, int x, int y, int size) {
		UUID id = Social.uuid(uuid);
		if (id != null) PlayerFaceExtractor.extractRenderState(g, net.minecraft.client.Minecraft.getInstance().playerSkinRenderCache().getOrDefault(ResolvableProfile.createUnresolved(id)).playerSkin(), x, y, size);
		else g.fill(x, y, x + size, y + size, OUTLINE);
	}

	public static void dot(GuiGraphicsExtractor g, int x, int y, int color) {
		g.fill(x + 1, y, x + 4, y + 5, color);
		g.fill(x, y + 1, x + 5, y + 4, color);
	}

	public static int statusColor(Bridge.Friend f) {
		if (!f.online()) return OFFLINE;
		return switch (f.status()) {
			case "hosting" -> PRIMARY;
			case "playing", "server" -> PLAYING;
			default -> ONLINE;
		};
	}

	public static String statusText(Bridge.Friend f) {
		if (!f.online()) return "Offline";
		if (f.detail() != null && !f.detail().isEmpty()) return f.detail();
		return switch (f.status()) {
			case "hosting" -> "Ha aperto un mondo";
			case "playing" -> "In gioco";
			case "server" -> "Su un server";
			default -> "Online";
		};
	}

	public static String fit(Font font, String text, int width) {
		if (font.width(text) <= width) return text;
		return font.plainSubstrByWidth(text, width - font.width("…")) + "…";
	}
}
