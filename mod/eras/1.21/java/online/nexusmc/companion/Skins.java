package online.nexusmc.companion;

import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Supplier;
import net.minecraft.client.Minecraft;
import net.minecraft.client.resources.DefaultPlayerSkin;
import net.minecraft.client.resources.PlayerSkin;

/** Skin degli amici: profilo chiesto ai server Mojang una volta sola, poi in cache. */
final class Skins {
	private static final Map<UUID, Supplier<PlayerSkin>> CACHE = new ConcurrentHashMap<>();

	private Skins() {}

	static PlayerSkin get(UUID id) {
		Supplier<PlayerSkin> known = CACHE.get(id);
		if (known != null) return known.get();
		Minecraft mc = Minecraft.getInstance();
		CACHE.put(id, () -> DefaultPlayerSkin.get(id));
		CompletableFuture.supplyAsync(() -> mc.getMinecraftSessionService().fetchProfile(id, false))
			.thenAcceptAsync(result -> {
				if (result != null) CACHE.put(id, mc.getSkinManager().lookupInsecure(result.profile()));
			}, mc);
		return DefaultPlayerSkin.get(id);
	}
}
