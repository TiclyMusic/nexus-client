package com.nexus.client

import com.nexus.client.launcher.NexusMode
import com.nexus.client.launcher.VersionManager
import com.nexus.client.switch.NexusSwitch
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Path

class NexusSwitchTest {

    @TempDir
    lateinit var tempDir: Path

    private fun createSwitch() = NexusSwitch(VersionManager(tempDir))

    @Test
    fun `test initial mode is clean`() {
        val switch = createSwitch()
        val mode = switch.getCurrentMode("1.20.4")
        assertNotNull(mode)
    }

    @Test
    fun `test toggle switches mode`() {
        val switch = createSwitch()
        switch.setMode("1.20.4", NexusMode.CLEAN)

        val newMode = switch.toggle("1.20.4")
        assertEquals(NexusMode.ENHANCED, newMode)

        val againMode = switch.toggle("1.20.4")
        assertEquals(NexusMode.CLEAN, againMode)
    }

    @Test
    fun `test setMode persists mode`() {
        val switch = createSwitch()
        switch.setMode("1.8.9", NexusMode.ENHANCED)
        assertEquals(NexusMode.ENHANCED, switch.getCurrentMode("1.8.9"))
    }

    @Test
    fun `test getModeLabel returns correct label`() {
        val switch = createSwitch()
        assertTrue(switch.getModeLabel(NexusMode.CLEAN).contains("Clean"))
        assertTrue(switch.getModeLabel(NexusMode.ENHANCED).contains("Enhanced"))
    }

    @Test
    fun `test getState returns correct state`() {
        val switch = createSwitch()
        switch.setMode("1.20.4", NexusMode.CLEAN)
        val state = switch.getState("1.20.4")

        assertEquals("1.20.4", state.versionId)
        assertEquals(NexusMode.CLEAN, state.currentMode)
        assertEquals(0, state.cleanModCount)
        assertEquals(0, state.enhancedModCount)
    }
}
