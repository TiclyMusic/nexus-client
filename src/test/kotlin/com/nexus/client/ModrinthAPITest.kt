package com.nexus.client

import com.nexus.client.update.AutoUpdater
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

class ModrinthAPITest {

    @Test
    fun `test AutoUpdater can be instantiated`() {
        val updater = AutoUpdater(currentVersion = "1.0.0")
        assertNotNull(updater)
    }

    @Test
    fun `test check for updates returns valid result when no release exists`() {
        // Use a version so high it will never be outdated
        val updater = AutoUpdater(currentVersion = "999.99.99")
        val result = updater.checkForUpdates()

        assertNotNull(result)
        assertNotNull(result.currentVersion)
        assertEquals("999.99.99", result.currentVersion)
        // Either update is available (real release exists) or not — both are valid
        assertFalse(result.available) // 999.99.99 is always "latest"
    }

    @Test
    fun `test isVersionNewer logic`() {
        val updater = AutoUpdater(currentVersion = "1.0.0")
        assertTrue(updater.isVersionNewer("1.0.1", "1.0.0"))
        assertTrue(updater.isVersionNewer("2.0.0", "1.9.9"))
        assertFalse(updater.isVersionNewer("1.0.0", "1.0.0"))
        assertFalse(updater.isVersionNewer("0.9.9", "1.0.0"))
    }
}
