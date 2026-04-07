package com.nexus.client.switch

import com.nexus.client.launcher.NexusMode
import com.nexus.client.launcher.VersionManager
import org.slf4j.LoggerFactory
import java.nio.file.Files
import java.util.prefs.Preferences

data class SwitchState(
    val versionId: String,
    val currentMode: NexusMode,
    val cleanModCount: Int,
    val enhancedModCount: Int
)

class NexusSwitch(private val versionManager: VersionManager) {

    private val logger = LoggerFactory.getLogger(NexusSwitch::class.java)
    private val prefs = Preferences.userNodeForPackage(NexusSwitch::class.java)

    val enhancedMods = mapOf(
        "1.8.9" to listOf(
            "toggle-sprint",
            "mouse-tweaks",
            "optifine"
        ),
        "1.20.4" to listOf(
            "sodium",
            "lithium",
            "iris",
            "modmenu",
            "toggle-sprint",
            "zoom",
            "mouse-tweaks"
        )
    )

    fun getCurrentMode(versionId: String): NexusMode {
        val saved = prefs.get("mode_$versionId", NexusMode.CLEAN.name)
        return NexusMode.valueOf(saved)
    }

    fun setMode(versionId: String, mode: NexusMode) {
        prefs.put("mode_$versionId", mode.name)
        logger.info("Nexus Switch: $versionId -> $mode")
    }

    fun toggle(versionId: String): NexusMode {
        val current = getCurrentMode(versionId)
        val newMode = if (current == NexusMode.CLEAN) NexusMode.ENHANCED else NexusMode.CLEAN
        setMode(versionId, newMode)
        return newMode
    }

    fun getState(versionId: String): SwitchState {
        val currentMode = getCurrentMode(versionId)
        val cleanModsDir = versionManager.getModsDir(versionId, NexusMode.CLEAN)
        val enhancedModsDir = versionManager.getModsDir(versionId, NexusMode.ENHANCED)

        val cleanCount = if (Files.exists(cleanModsDir))
            Files.list(cleanModsDir).filter { it.toString().endsWith(".jar") }.count().toInt()
        else 0
        val enhancedCount = if (Files.exists(enhancedModsDir))
            Files.list(enhancedModsDir).filter { it.toString().endsWith(".jar") }.count().toInt()
        else 0

        return SwitchState(versionId, currentMode, cleanCount, enhancedCount)
    }

    fun getEffectiveModsDir(versionId: String) =
        versionManager.getModsDir(versionId, getCurrentMode(versionId))

    fun getModeLabel(mode: NexusMode): String = when (mode) {
        NexusMode.CLEAN -> "⬜ Clean"
        NexusMode.ENHANCED -> "🔷 Enhanced"
    }

    fun getModeDescription(mode: NexusMode): String = when (mode) {
        NexusMode.CLEAN -> "Standard Minecraft with your selected mods"
        NexusMode.ENHANCED -> "Enhanced experience with optimized utility mods"
    }
}
