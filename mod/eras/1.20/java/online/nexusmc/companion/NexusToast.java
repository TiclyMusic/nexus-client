package online.nexusmc.companion;

import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.Font;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.components.toasts.Toast;
import net.minecraft.client.gui.components.toasts.ToastComponent;

/** Avviso in alto a destra con la testa dell'amico (richieste, inviti, messaggi). */
public final class NexusToast implements Toast {
	private static final long DURATION = 6000;
	private final String uuid;
	private final String title;
	private final String body;

	private NexusToast(String uuid, String title, String body) {
		this.uuid = uuid;
		this.title = title;
		this.body = body == null ? "" : body;
	}

	/** Thread-safe: il toast viene aggiunto sul thread del client. */
	public static void show(String uuid, String title, String body) {
		Minecraft mc = Minecraft.getInstance();
		mc.execute(() -> mc.getToasts().addToast(new NexusToast(uuid, title, body)));
	}

	@Override
	public int width() {
		return 200;
	}

	@Override
	public Visibility render(GuiGraphics g, ToastComponent toasts, long visibleForMs) {
		Font font = toasts.getMinecraft().font;
		Ui.panel(g, 0, 0, width(), height(), 5, Ui.SURFACE_HIGH);
		g.fill(0, 6, 2, height() - 6, Ui.PRIMARY);
		Ui.face(g, uuid, 8, 8, 16);
		g.drawString(font, Ui.fit(font, title, width() - 40), 32, 7, Ui.TEXT, false);
		g.drawString(font, Ui.fit(font, body, width() - 40), 32, 18, Ui.MUTED, false);
		return visibleForMs > DURATION ? Visibility.HIDE : Visibility.SHOW;
	}
}
