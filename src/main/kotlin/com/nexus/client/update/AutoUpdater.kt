package com.nexus.client.update

import com.google.gson.Gson
import com.google.gson.JsonObject
import okhttp3.OkHttpClient
import okhttp3.Request
import org.slf4j.LoggerFactory
import java.io.File
import java.nio.file.Files

data class UpdateInfo(
    val available: Boolean,
    val currentVersion: String,
    val latestVersion: String,
    val downloadUrl: String = "",
    val releaseNotes: String = "",
    val publishedAt: String = ""
)

class AutoUpdater(
    private val currentVersion: String = "1.0.0",
    private val githubRepo: String = "matthias-peterlini/Nexus-client"
) {
    private val logger = LoggerFactory.getLogger(AutoUpdater::class.java)
    private val client = OkHttpClient()
    private val gson = Gson()

    fun checkForUpdates(): UpdateInfo {
        return try {
            val request = Request.Builder()
                .url("https://api.github.com/repos/$githubRepo/releases/latest")
                .header("Accept", "application/vnd.github.v3+json")
                .header("User-Agent", "NexusClient/$currentVersion")
                .build()

            val response = client.newCall(request).execute()
            if (!response.isSuccessful) {
                return UpdateInfo(false, currentVersion, currentVersion)
            }

            val json = gson.fromJson(response.body!!.string(), JsonObject::class.java)
            val latestVersion = json.get("tag_name").asString.removePrefix("v")
            val releaseNotes = json.get("body")?.asString ?: ""
            val publishedAt = json.get("published_at")?.asString ?: ""

            val downloadUrl = json.getAsJsonArray("assets")
                ?.firstOrNull { it.asJsonObject.get("name").asString.endsWith(".jar") }
                ?.asJsonObject?.get("browser_download_url")?.asString ?: ""

            val isNewer = isVersionNewer(latestVersion, currentVersion)

            UpdateInfo(
                available = isNewer,
                currentVersion = currentVersion,
                latestVersion = latestVersion,
                downloadUrl = downloadUrl,
                releaseNotes = releaseNotes,
                publishedAt = publishedAt
            )
        } catch (e: Exception) {
            logger.warn("Update check failed: ${e.message}")
            UpdateInfo(false, currentVersion, currentVersion)
        }
    }

    fun downloadUpdate(updateInfo: UpdateInfo, progressCallback: (Int, String) -> Unit = { _, _ -> }): File? {
        if (!updateInfo.available || updateInfo.downloadUrl.isEmpty()) return null

        return try {
            progressCallback(0, "Downloading update ${updateInfo.latestVersion}...")

            val request = Request.Builder().url(updateInfo.downloadUrl).build()
            val response = client.newCall(request).execute()

            val tempFile = Files.createTempFile("nexus-update-", ".jar").toFile()
            response.body!!.byteStream().use { input ->
                tempFile.outputStream().use { output ->
                    input.copyTo(output)
                }
            }

            progressCallback(100, "Update downloaded!")
            logger.info("Update downloaded to ${tempFile.absolutePath}")
            tempFile
        } catch (e: Exception) {
            logger.error("Failed to download update: ${e.message}")
            null
        }
    }

    fun applyUpdate(updateFile: File) {
        val currentJar = File(AutoUpdater::class.java.protectionDomain.codeSource.location.toURI())
        val updaterScript = createUpdaterScript(currentJar, updateFile)

        ProcessBuilder(updaterScript).start()

        logger.info("Update process started, shutting down...")
        Thread.sleep(1000)
        System.exit(0)
    }

    private fun createUpdaterScript(currentJar: File, newJar: File): List<String> {
        val os = System.getProperty("os.name").lowercase()
        return if (os.contains("win")) {
            val bat = Files.createTempFile("nexus-update-", ".bat").toFile()
            bat.writeText(
                """
                @echo off
                timeout /t 2 /nobreak > NUL
                copy /Y "${newJar.absolutePath}" "${currentJar.absolutePath}"
                start "" java -jar "${currentJar.absolutePath}"
                del "${bat.absolutePath}"
                """.trimIndent()
            )
            listOf("cmd", "/c", bat.absolutePath)
        } else {
            val sh = Files.createTempFile("nexus-update-", ".sh").toFile()
            sh.writeText(
                """
                #!/bin/bash
                sleep 2
                cp "${newJar.absolutePath}" "${currentJar.absolutePath}"
                java -jar "${currentJar.absolutePath}" &
                rm "${sh.absolutePath}"
                """.trimIndent()
            )
            sh.setExecutable(true)
            listOf("bash", sh.absolutePath)
        }
    }

    fun isVersionNewer(latest: String, current: String): Boolean {
        return try {
            val latestParts = latest.split(".").map { it.toInt() }
            val currentParts = current.split(".").map { it.toInt() }

            for (i in 0 until maxOf(latestParts.size, currentParts.size)) {
                val l = latestParts.getOrElse(i) { 0 }
                val c = currentParts.getOrElse(i) { 0 }
                if (l > c) return true
                if (l < c) return false
            }
            false
        } catch (e: Exception) {
            false
        }
    }
}
