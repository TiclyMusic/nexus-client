package com.nexus.client.mods

import com.nexus.client.launcher.NexusMode
import com.nexus.client.launcher.VersionManager
import okhttp3.OkHttpClient
import okhttp3.Request
import org.slf4j.LoggerFactory
import java.io.File
import java.nio.file.Files
import java.nio.file.Path

data class InstalledMod(
    val projectId: String,
    val name: String,
    val filename: String,
    val version: String,
    val gameVersion: String,
    val mode: NexusMode,
    val enabled: Boolean = true
)

class ModManager(
    private val versionManager: VersionManager,
    private val api: ModrinthAPI = ModrinthAPI()
) {
    private val logger = LoggerFactory.getLogger(ModManager::class.java)
    private val httpClient = OkHttpClient()

    fun installMod(
        projectId: String,
        gameVersion: String,
        loader: String,
        mode: NexusMode = NexusMode.CLEAN,
        progressCallback: (Int, String) -> Unit = { _, _ -> }
    ) {
        progressCallback(0, "Fetching mod info...")
        val versions = api.getVersions(projectId, gameVersion, loader)

        if (versions.isEmpty()) {
            throw IllegalArgumentException(
                "No compatible version found for $projectId on MC $gameVersion with $loader"
            )
        }

        val latestVersion = versions.first()
        val primaryFile = latestVersion.files.firstOrNull { it.primary } ?: latestVersion.files.first()

        progressCallback(10, "Installing dependencies...")
        for (dep in latestVersion.dependencies.filter { it.dependencyType == "required" }) {
            val depProjectId = dep.projectId ?: continue
            try {
                installMod(depProjectId, gameVersion, loader, mode) { p, msg ->
                    progressCallback((p * 0.4).toInt(), "Dependency: $msg")
                }
            } catch (e: Exception) {
                logger.warn("Failed to install dependency $depProjectId: ${e.message}")
            }
        }

        val modsDir = versionManager.getModsDir(gameVersion, mode)
        val destFile = modsDir.resolve(primaryFile.filename)

        if (Files.exists(destFile)) {
            progressCallback(100, "Already installed")
            return
        }

        progressCallback(50, "Downloading ${primaryFile.filename}...")
        downloadFile(primaryFile.url, destFile)
        progressCallback(100, "Installed ${primaryFile.filename}")

        logger.info("Installed mod ${primaryFile.filename} for MC $gameVersion [$mode]")
    }

    fun removeMod(filename: String, gameVersion: String, mode: NexusMode) {
        val modsDir = versionManager.getModsDir(gameVersion, mode)
        val file = modsDir.resolve(filename)
        if (Files.exists(file)) {
            Files.delete(file)
            logger.info("Removed mod $filename")
        }
    }

    fun listMods(gameVersion: String, mode: NexusMode): List<File> {
        val modsDir = versionManager.getModsDir(gameVersion, mode)
        if (!Files.exists(modsDir)) return emptyList()
        return modsDir.toFile().listFiles { f -> f.extension == "jar" }?.toList() ?: emptyList()
    }

    fun enableMod(filename: String, gameVersion: String, mode: NexusMode) {
        val modsDir = versionManager.getModsDir(gameVersion, mode)
        val disabledFile = modsDir.resolve("$filename.disabled")
        val enabledFile = modsDir.resolve(filename)
        if (Files.exists(disabledFile)) {
            Files.move(disabledFile, enabledFile)
        }
    }

    fun disableMod(filename: String, gameVersion: String, mode: NexusMode) {
        val modsDir = versionManager.getModsDir(gameVersion, mode)
        val enabledFile = modsDir.resolve(filename)
        val disabledFile = modsDir.resolve("$filename.disabled")
        if (Files.exists(enabledFile)) {
            Files.move(enabledFile, disabledFile)
        }
    }

    private fun downloadFile(url: String, dest: Path) {
        val request = Request.Builder().url(url).build()
        val response = httpClient.newCall(request).execute()
        if (!response.isSuccessful) throw RuntimeException("Download failed: HTTP ${response.code}")
        Files.createDirectories(dest.parent)
        response.body!!.byteStream().use { input ->
            Files.newOutputStream(dest).use { output ->
                input.copyTo(output)
            }
        }
    }
}
