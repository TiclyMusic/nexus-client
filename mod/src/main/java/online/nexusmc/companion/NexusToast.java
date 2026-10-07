package online.nexusmc.companion;

import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.Font;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.components.toasts.Toast;
import net.minecraft.client.gui.components.toasts.ToastManager;

/** Avviso in alto a destra con la testa dell'amico (richieste, inviti, messaggi). */
public final class NexusToast implements Toast {
	private static final long DURATION = 6000;
	private final String uuid;
	private final String title;
	private final String body;
	private Visibility visibility = Visibility.SHOW;

	private NexusToast(String uuid, String title, String body) {
		this.uuid = uuid;
		this.title = title;
		this.body = body == null ? "" : body;
	}

	/** Thread-safe: il toast viene aggiunto sul thread del client. */
	public static void show(String uuid, String title, String body) {
		Minecraft mc = Minecraft.getInstance();
		mc.execute(() -> mc.gui.toastManager().addToast(new NexusToast(uuid, title, body)));
	}

	@Override
	public int width() {
		return 200;
	}

	@Override
	public Visibility getWantedVisibility() {
		return visibility;
	}

	@Override
	public void update(ToastManager manager, long fullyVisibleForMs) {
		if (fullyVisibleForMs > DURATION) visibility = Visibility.HIDE;
	}

	@Override
	public void extractRenderState(GuiGraphicsExtractor g, Font font, long fullyVisibleForMs) {
		Ui.panel(g, 0, 0, width(), height(), 5, Ui.SURFACE_HIGH);
		g.fill(0, 6, 2, height() - 6, Ui.PRIMARY);
		Ui.face(g, uuid, 8, 8, 16);
		g.text(font, Ui.fit(font, title, width() - 40), 32, 7, Ui.TEXT, false);
		g.text(font, Ui.fit(font, body, width() - 40), 32, 18, Ui.MUTED, false);
	}
}
