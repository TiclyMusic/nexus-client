package online.nexusmc.companion;

import com.mojang.authlib.GameProfile;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import net.minecraft.client.Minecraft;
import net.minecraft.client.resources.DefaultPlayerSkin;
import net.minecraft.resources.ResourceLocation;

/** Skin degli amici (1.20.1): profilo chiesto ai server Mojang una volta sola, poi in cache. */
final class Skins {
	private static final Map<UUID, ResourceLocation> CACHE = new ConcurrentHashMap<>();

	private Skins() {}

	static ResourceLocation get(UUID id) {
		ResourceLocation known = CACHE.get(id);
		if (known != null) return known;
		Minecraft mc = Minecraft.getInstance();
		ResourceLocation fallback = DefaultPlayerSkin.getDefaultSkin(id);
		CACHE.put(id, fallback);
		CompletableFuture.supplyAsync(() -> mc.getMinecraftSessionService().fillProfileProperties(new GameProfile(id, null), false))
			.thenAcceptAsync(profile -> {
				if (profile != null) CACHE.put(id, mc.getSkinManager().getInsecureSkinLocation(profile));
			}, mc);
		return fallback;
	}
}
