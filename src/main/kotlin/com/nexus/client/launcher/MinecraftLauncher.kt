package com.nexus.client.launcher

import com.google.gson.Gson
import com.google.gson.JsonObject
import com.nexus.client.auth.MinecraftProfile
import okhttp3.OkHttpClient
import okhttp3.Request
import org.slf4j.LoggerFactory
import java.io.File
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.Paths

class MinecraftLauncher(private val versionManager: VersionManager) {

    private val logger = LoggerFactory.getLogger(MinecraftLauncher::class.java)
    private val client = OkHttpClient()
    private val gson = Gson()

    data class LaunchConfig(
        val versionId: String,
        val modLoader: ModLoader,
        val nexusMode: NexusMode,
        val profile: MinecraftProfile,
        val jvmArgs: List<String> = defaultJvmArgs(),
        val gameArgs: List<String> = emptyList(),
        val allocatedRamMb: Int = 2048
    )

    companion object {
        fun defaultJvmArgs(): List<String> = listOf(
            "-XX:+UseG1GC",
            "-XX:+ParallelRefProcEnabled",
            "-XX:MaxGCPauseMillis=200",
            "-XX:+UnlockExperimentalVMOptions",
            "-XX:+DisableExplicitGC",
            "-XX:+AlwaysPreTouch",
            "-XX:G1HeapWastePercent=5",
            "-XX:G1MixedGCCountTarget=4",
            "-XX:G1MixedGCLiveThresholdPercent=90",
            "-XX:G1RSetUpdatingPauseTimePercent=5",
            "-XX:SurvivorRatio=32",
            "-XX:+PerfDisableSharedMem",
            "-XX:MaxTenuringThreshold=1",
            "-Dusing.aikars.flags=https://mcflags.emc.gs",
            "-Daikars.new.flags=true"
        )

        fun findJavaExecutable(): String {
            val javaHome = System.getenv("JAVA_HOME") ?: System.getProperty("java.home") ?: ""
            val javaExe = if (System.getProperty("os.name").lowercase().contains("win")) "java.exe" else "java"
            val javaPath = Paths.get(javaHome, "bin", javaExe)
            return if (Files.exists(javaPath)) javaPath.toString() else "java"
        }
    }

    fun launch(config: LaunchConfig): Process {
        val profile = versionManager.getVersionProfile(config.versionId, config.modLoader)
        val gameDir = profile.gameDir
        val modsDir = versionManager.getModsDir(config.versionId, config.nexusMode)

        Files.createDirectories(gameDir)

        val command = buildLaunchCommand(config, gameDir, modsDir)

        logger.info("Launching Minecraft ${config.versionId} [${config.nexusMode}]")
        logger.info("Mods dir: $modsDir")
        logger.debug("Command: ${command.joinToString(" ")}")

        return ProcessBuilder(command)
            .directory(gameDir.toFile())
            .inheritIO()
            .start()
    }

    private fun buildLaunchCommand(
        config: LaunchConfig,
        gameDir: Path,
        modsDir: Path
    ): List<String> {
        val java = findJavaExecutable()
        val libs = resolveLibraries(config.versionId, gameDir)
        val classpath = libs.joinToString(File.pathSeparator)

        return buildList {
            add(java)
            add("-Xmx${config.allocatedRamMb}m")
            add("-Xms512m")
            addAll(config.jvmArgs)
            add("-Djava.library.path=${gameDir.resolve("natives")}")
            add("-cp")
            add(classpath)
            add(getMainClass(config.versionId, config.modLoader))
            add("--username")
            add(config.profile.username)
            add("--uuid")
            add(config.profile.uuid)
            add("--accessToken")
            add(config.profile.accessToken)
            add("--gameDir")
            add(gameDir.toString())
            add("--assetsDir")
            add(gameDir.resolve("assets").toString())
            add("--version")
            add(config.versionId)
            addAll(config.gameArgs)
        }
    }

    private fun getMainClass(versionId: String, modLoader: ModLoader): String {
        return when (modLoader) {
            ModLoader.FABRIC -> "net.fabricmc.loader.impl.launch.knot.KnotClient"
            ModLoader.FORGE -> "net.minecraftforge.bootstrap.ForgeBootstrap"
            ModLoader.LEGACY_FABRIC -> "net.fabricmc.loader.launch.knot.KnotClient"
            ModLoader.VANILLA -> "net.minecraft.client.main.Main"
        }
    }

    private fun resolveLibraries(versionId: String, gameDir: Path): List<String> {
        val libsDir = gameDir.resolve("libraries")
        if (!Files.exists(libsDir)) return listOf(gameDir.resolve("${versionId}.jar").toString())

        val jars = mutableListOf<String>()
        Files.walk(libsDir)
            .filter { it.toString().endsWith(".jar") }
            .forEach { jars.add(it.toString()) }
        jars.add(gameDir.resolve("${versionId}.jar").toString())
        return jars
    }

    fun downloadVersion(versionId: String, progressCallback: (Int, String) -> Unit = { _, _ -> }) {
        logger.info("Downloading Minecraft $versionId...")
        progressCallback(0, "Fetching version manifest...")

        val profile = versionManager.getVersionProfile(versionId)
        val versionUrl = profile.version.url

        if (versionUrl.isEmpty()) {
            logger.warn("No URL for version $versionId, skipping download")
            return
        }

        progressCallback(10, "Downloading version JSON...")
        val versionJson = downloadJson(versionUrl)

        progressCallback(30, "Downloading client jar...")
        val clientJarUrl = versionJson
            .getAsJsonObject("downloads")
            .getAsJsonObject("client")
            .get("url").asString

        val jarPath = profile.gameDir.resolve("${versionId}.jar")
        Files.createDirectories(profile.gameDir)
        downloadFile(clientJarUrl, jarPath.toFile())

        progressCallback(70, "Downloading assets...")
        progressCallback(100, "Done!")
        logger.info("Minecraft $versionId downloaded successfully")
    }

    private fun downloadJson(url: String): JsonObject {
        val request = Request.Builder().url(url).build()
        val response = client.newCall(request).execute()
        return gson.fromJson(response.body!!.string(), JsonObject::class.java)
    }

    private fun downloadFile(url: String, dest: File) {
        val request = Request.Builder().url(url).build()
        val response = client.newCall(request).execute()
        response.body!!.byteStream().use { input ->
            dest.outputStream().use { output ->
                input.copyTo(output)
            }
        }
    }
}
