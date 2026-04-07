package com.nexus.client

import com.nexus.client.mods.ModrinthAPI
import com.nexus.client.update.AutoUpdater
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

class ModrinthAPITest {

    @Test
    fun `test ModrinthAPI can be instantiated`() {
        val api = ModrinthAPI()
        assertNotNull(api)
    }

    @Test
    fun `test AutoUpdater version comparison - newer patch`() {
        val updater = AutoUpdater(currentVersion = "1.0.0")
        assertTrue(updater.isVersionNewer("1.0.1", "1.0.0"))
    }

    @Test
    fun `test AutoUpdater version comparison - newer major`() {
        val updater = AutoUpdater(currentVersion = "1.0.0")
        assertTrue(updater.isVersionNewer("2.0.0", "1.9.9"))
    }

    @Test
    fun `test AutoUpdater version comparison - same version`() {
        val updater = AutoUpdater(currentVersion = "1.0.0")
        assertFalse(updater.isVersionNewer("1.0.0", "1.0.0"))
    }

    @Test
    fun `test AutoUpdater version comparison - older version`() {
        val updater = AutoUpdater(currentVersion = "1.0.0")
        assertFalse(updater.isVersionNewer("0.9.9", "1.0.0"))
    }

    @Test
    fun `test AutoUpdater check returns valid result`() {
        // Use a version so high no release will ever exceed it
        val updater = AutoUpdater(currentVersion = "999.99.99")
        val result = updater.checkForUpdates()

        assertNotNull(result)
        assertEquals("999.99.99", result.currentVersion)
        assertFalse(result.available)
    }
}
