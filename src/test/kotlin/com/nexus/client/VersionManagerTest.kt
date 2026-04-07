package com.nexus.client

import com.nexus.client.launcher.ModLoader
import com.nexus.client.launcher.NexusMode
import com.nexus.client.launcher.VersionManager
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Path

class VersionManagerTest {

    @TempDir
    lateinit var tempDir: Path

    private fun createManager() = VersionManager(tempDir)

    @Test
    fun `test supported versions list`() {
        assertTrue(VersionManager.SUPPORTED_VERSIONS.contains("1.8.9"))
        assertTrue(VersionManager.SUPPORTED_VERSIONS.contains("1.20.4"))
        assertTrue(VersionManager.SUPPORTED_VERSIONS.isNotEmpty())
    }

    @Test
    fun `test getModsDir creates directories`() {
        val manager = createManager()
        val cleanDir = manager.getModsDir("1.20.4", NexusMode.CLEAN)
        val enhancedDir = manager.getModsDir("1.20.4", NexusMode.ENHANCED)

        assertTrue(cleanDir.toFile().exists())
        assertTrue(enhancedDir.toFile().exists())
        assertTrue(cleanDir.toString().contains("clean"))
        assertTrue(enhancedDir.toString().contains("enhanced"))
    }

    @Test
    fun `test listInstalledVersions returns empty for fresh install`() {
        val manager = createManager()
        val versions = manager.listInstalledVersions()
        assertTrue(versions.isEmpty())
    }

    @Test
    fun `test getVersionProfile creates game directory`() {
        val manager = createManager()
        val profile = manager.getVersionProfile("1.20.4", ModLoader.FABRIC)

        assertEquals("1.20.4", profile.version.id)
        assertEquals(ModLoader.FABRIC, profile.modLoader)
        assertTrue(profile.gameDir.toString().contains("1.20.4"))
    }

    @Test
    fun `test getModsDir clean and enhanced are different paths`() {
        val manager = createManager()
        val clean = manager.getModsDir("1.20.4", NexusMode.CLEAN)
        val enhanced = manager.getModsDir("1.20.4", NexusMode.ENHANCED)
        assertNotEquals(clean, enhanced)
    }
}
