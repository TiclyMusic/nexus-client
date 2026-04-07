package com.nexus.client.social

import com.google.gson.Gson
import com.google.gson.JsonObject
import com.google.gson.JsonArray
import org.slf4j.LoggerFactory
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.channels.SocketChannel
import java.nio.file.Path
import java.nio.file.Paths
import java.util.UUID

data class RichPresence(
    val details: String = "",
    val state: String = "",
    val largeImageKey: String = "nexus_logo",
    val largeImageText: String = "Nexus Client",
    val smallImageKey: String? = null,
    val smallImageText: String? = null,
    val startTimestamp: Long? = System.currentTimeMillis() / 1000,
    val partyId: String? = null,
    val partySize: Int? = null,
    val partyMax: Int? = null
)

class DiscordRPCManager(
    // Provide a valid Discord application ID from https://discord.com/developers/applications
    private val applicationId: String
) {
    private val logger = LoggerFactory.getLogger(DiscordRPCManager::class.java)
    private val gson = Gson()
    private var connected = false
    private var channel: SocketChannel? = null

    init {
        require(applicationId.isNotBlank()) {
            "Discord application ID must not be blank. Register your app at https://discord.com/developers/applications"
        }
        if (applicationId == "0") {
            logger.warn("Discord application ID is not configured. Set NEXUS_DISCORD_APP_ID to enable Rich Presence.")
        }
    }

    fun connect(): Boolean {
        return try {
            val socketPath = findDiscordSocket() ?: run {
                logger.warn("Discord socket not found - is Discord running?")
                return false
            }

            // Use reflection to avoid compile-time dependency on Java 16+ APIs
            val addressClass = Class.forName("java.net.UnixDomainSocketAddress")
            val ofMethod = addressClass.getMethod("of", Path::class.java)
            val address = ofMethod.invoke(null, socketPath)

            val protocolFamilyClass = Class.forName("java.net.StandardProtocolFamily")
            val unixEnum = protocolFamilyClass.enumConstants
                .filterIsInstance<Enum<*>>()
                .firstOrNull { it.name == "UNIX" }
                ?: run {
                    logger.warn("UNIX protocol family not found")
                    return false
                }

            val openMethod = SocketChannel::class.java.getMethod("open", Class.forName("java.net.ProtocolFamily"))
            channel = openMethod.invoke(null, unixEnum) as SocketChannel
            val connectMethod = channel!!.javaClass.getMethod("connect", Class.forName("java.net.SocketAddress"))
            connectMethod.invoke(channel, address)

            val handshake = JsonObject().apply {
                addProperty("v", 1)
                addProperty("client_id", applicationId)
            }
            sendFrame(0, handshake.toString())

            val response = readFrame()
            connected = response != null

            if (connected) logger.info("Discord RPC connected")
            else logger.warn("Discord RPC handshake failed")

            connected
        } catch (e: Exception) {
            logger.warn("Failed to connect to Discord: ${e.message}")
            false
        }
    }

    fun updatePresence(presence: RichPresence) {
        if (!connected) return

        val activity = JsonObject().apply {
            addProperty("details", presence.details)
            addProperty("state", presence.state)

            add("assets", JsonObject().apply {
                addProperty("large_image", presence.largeImageKey)
                addProperty("large_text", presence.largeImageText)
                presence.smallImageKey?.let { addProperty("small_image", it) }
                presence.smallImageText?.let { addProperty("small_text", it) }
            })

            presence.startTimestamp?.let {
                add("timestamps", JsonObject().apply {
                    addProperty("start", it)
                })
            }

            if (presence.partyId != null) {
                add("party", JsonObject().apply {
                    addProperty("id", presence.partyId)
                    add("size", JsonArray().apply {
                        add(presence.partySize ?: 1)
                        add(presence.partyMax ?: 4)
                    })
                })
            }
        }

        val payload = JsonObject().apply {
            addProperty("cmd", "SET_ACTIVITY")
            add("args", JsonObject().apply {
                addProperty("pid", ProcessHandle.current().pid().toInt())
                add("activity", activity)
            })
            addProperty("nonce", UUID.randomUUID().toString())
        }

        try {
            sendFrame(1, payload.toString())
        } catch (e: Exception) {
            logger.warn("Failed to update Discord presence: ${e.message}")
            connected = false
        }
    }

    fun setPlayingMinecraft(version: String, server: String? = null) {
        updatePresence(
            RichPresence(
                details = "Playing Minecraft $version",
                state = server ?: "In Main Menu",
                largeImageKey = "nexus_logo",
                largeImageText = "Nexus Client"
            )
        )
    }

    fun setInLauncher() {
        updatePresence(
            RichPresence(
                details = "In Nexus Client Launcher",
                state = "Selecting a version...",
                largeImageKey = "nexus_logo",
                largeImageText = "Nexus Client"
            )
        )
    }

    fun disconnect() {
        try {
            channel?.close()
        } catch (e: Exception) {
            // Ignore on close
        }
        connected = false
        logger.info("Discord RPC disconnected")
    }

    val isConnected: Boolean get() = connected

    private fun findDiscordSocket(): Path? {
        val os = System.getProperty("os.name").lowercase()
        val candidates: List<Path> = when {
            os.contains("win") -> {
                // Windows Discord IPC uses named pipes (\\.\pipe\discord-ipc-N).
                // Named pipes are not accessible via Java's UnixDomainSocketAddress; native
                // support (JNA or a dedicated library) is required. Discord RPC is therefore
                // unavailable on Windows in this build. See README for details.
                logger.info("Discord RPC via Unix socket is not supported on Windows")
                return null
            }
            os.contains("mac") -> listOf(
                Paths.get(
                    System.getProperty("user.home"),
                    "Library", "Application Support", "discord", "discord-ipc-0"
                )
            )
            else -> {
                val tmpDir = System.getenv("XDG_RUNTIME_DIR") ?: "/tmp"
                (0..9).map { Paths.get(tmpDir, "discord-ipc-$it") }
            }
        }
        return candidates.firstOrNull { java.nio.file.Files.exists(it) }
    }

    private fun sendFrame(opcode: Int, data: String) {
        val bytes = data.toByteArray(Charsets.UTF_8)
        val buffer = ByteBuffer.allocate(8 + bytes.size).order(ByteOrder.LITTLE_ENDIAN)
        buffer.putInt(opcode)
        buffer.putInt(bytes.size)
        buffer.put(bytes)
        buffer.flip()
        channel?.write(buffer)
    }

    private fun readFrame(): String? {
        val header = ByteBuffer.allocate(8).order(ByteOrder.LITTLE_ENDIAN)
        val bytesRead = channel?.read(header) ?: return null
        if (bytesRead < 8) return null
        header.flip()
        header.getInt() // opcode (ignored)
        val length = header.getInt()

        val body = ByteBuffer.allocate(length)
        channel?.read(body)
        body.flip()
        return String(body.array(), Charsets.UTF_8)
    }
}
