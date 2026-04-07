package com.nexus.client.launcher

import com.google.gson.Gson
import com.google.gson.JsonObject
import okhttp3.OkHttpClient
import okhttp3.Request
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.Paths

data class MinecraftVersion(
    val id: String,
    val type: String,
    val url: String,
    val releaseTime: String,
    val modLoader: ModLoader = ModLoader.VANILLA
)

enum class ModLoader { VANILLA, FABRIC, FORGE, LEGACY_FABRIC }

data class VersionProfile(
    val version: MinecraftVersion,
    val modLoader: ModLoader,
    val gameDir: Path,
    val modsDir: Path,
    val nexusMode: NexusMode = NexusMode.CLEAN
)

enum class NexusMode { CLEAN, ENHANCED }

class VersionManager(private val nexusDir: Path = getDefaultNexusDir()) {

    private val client = OkHttpClient()
    private val gson = Gson()
    private val versionsDir = nexusDir.resolve("versions")
    private val profilesDir = nexusDir.resolve("profiles")

    companion object {
        private const val VERSION_MANIFEST_URL =
            "https://launchermeta.mojang.com/mc/game/version_manifest_v2.json"

        val SUPPORTED_VERSIONS = listOf("1.8.9", "1.12.2", "1.16.5", "1.18.2", "1.19.4", "1.20.4", "1.20.6")

        fun getDefaultNexusDir(): Path {
            val os = System.getProperty("os.name").lowercase()
            return when {
                os.contains("win") -> Paths.get(System.getenv("APPDATA") ?: "", ".nexus-client")
                os.contains("mac") -> Paths.get(
                    System.getProperty("user.home"), "Library", "Application Support", "nexus-client"
                )
                else -> Paths.get(System.getProperty("user.home"), ".nexus-client")
            }
        }
    }

    init {
        Files.createDirectories(versionsDir)
        Files.createDirectories(profilesDir)
    }

    fun fetchVersionManifest(): List<MinecraftVersion> {
        val request = Request.Builder().url(VERSION_MANIFEST_URL).build()
        val response = client.newCall(request).execute()
        val json = gson.fromJson(response.body!!.string(), JsonObject::class.java)

        return json.getAsJsonArray("versions").map { el ->
            val v = el.asJsonObject
            MinecraftVersion(
                id = v.get("id").asString,
                type = v.get("type").asString,
                url = v.get("url").asString,
                releaseTime = v.get("releaseTime").asString
            )
        }.filter { it.id in SUPPORTED_VERSIONS }
    }

    fun getVersionProfile(versionId: String, modLoader: ModLoader = ModLoader.FABRIC): VersionProfile {
        val gameDir = versionsDir.resolve(versionId)
        val modsDir = gameDir.resolve("mods").resolve("clean")
        val enhancedModsDir = gameDir.resolve("mods").resolve("enhanced")

        Files.createDirectories(modsDir)
        Files.createDirectories(enhancedModsDir)

        val versions = try {
            fetchVersionManifest()
        } catch (e: Exception) {
            listOf(MinecraftVersion(versionId, "release", "", ""))
        }
        val version = versions.find { it.id == versionId }
            ?: MinecraftVersion(versionId, "release", "", "")

        return VersionProfile(
            version = version,
            modLoader = modLoader,
            gameDir = gameDir,
            modsDir = modsDir
        )
    }

    fun getModsDir(versionId: String, mode: NexusMode = NexusMode.CLEAN): Path {
        val baseDir = versionsDir.resolve(versionId).resolve("mods")
        return when (mode) {
            NexusMode.CLEAN -> baseDir.resolve("clean")
            NexusMode.ENHANCED -> baseDir.resolve("enhanced")
        }.also { Files.createDirectories(it) }
    }

    fun listInstalledVersions(): List<String> {
        if (!Files.exists(versionsDir)) return emptyList()
        return Files.list(versionsDir)
            .filter { Files.isDirectory(it) }
            .map { it.fileName.toString() }
            .toList()
    }

    fun getNexusDir(): Path = nexusDir
    fun getVersionsDir(): Path = versionsDir
}
