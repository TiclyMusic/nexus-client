package com.nexus.client.ui

import com.nexus.client.auth.MinecraftProfile
import com.nexus.client.launcher.MinecraftLauncher
import com.nexus.client.launcher.ModLoader
import com.nexus.client.launcher.NexusMode
import com.nexus.client.launcher.VersionManager
import com.nexus.client.mods.ModManager
import com.nexus.client.mods.ModrinthAPI
import com.nexus.client.social.DiscordRPCManager
import com.nexus.client.switch.NexusSwitch
import com.nexus.client.update.AutoUpdater
import javafx.application.Application
import javafx.application.Platform
import javafx.geometry.Insets
import javafx.geometry.Pos
import javafx.scene.Scene
import javafx.scene.control.*
import javafx.scene.layout.*

class MainWindow : Application() {

    private val versionManager = VersionManager()
    private val launcher = MinecraftLauncher(versionManager)
    private val modrinthAPI = ModrinthAPI()
    private val modManager = ModManager(versionManager, modrinthAPI)
    private val nexusSwitch = NexusSwitch(versionManager)
    private val discordRPC = DiscordRPCManager(
        // Set NEXUS_DISCORD_APP_ID env var or replace with your Discord application ID.
        // Register at https://discord.com/developers/applications
        applicationId = System.getenv("NEXUS_DISCORD_APP_ID") ?: DiscordRPCManager.UNCONFIGURED_ID
    )
    private val autoUpdater = AutoUpdater()

    internal var currentProfile: MinecraftProfile? = null
    internal val statusLabel = Label("Ready")

    override fun start(primaryStage: javafx.stage.Stage) {
        primaryStage.title = "Nexus Client"
        primaryStage.minWidth = 900.0
        primaryStage.minHeight = 600.0

        val root = buildUI()
        val scene = Scene(root, 960.0, 640.0)

        val css = javaClass.getResource("/com/nexus/client/style.css")
        if (css != null) scene.stylesheets.add(css.toExternalForm())

        primaryStage.scene = scene
        primaryStage.show()

        Thread {
            discordRPC.connect()
            discordRPC.setInLauncher()
        }.start()

        checkForUpdates()
    }

    internal fun buildUI(): BorderPane {
        val root = BorderPane()
        root.styleClass.add("root-pane")

        root.top = buildTopBar()

        val tabPane = TabPane()
        tabPane.styleClass.add("main-tab-pane")
        tabPane.tabClosingPolicy = TabPane.TabClosingPolicy.UNAVAILABLE

        tabPane.tabs.addAll(
            LauncherTab(this, versionManager, launcher, nexusSwitch, modManager, modrinthAPI).build(),
            ModsTab(this, versionManager, modrinthAPI).build(),
            SettingsTab(this, versionManager, launcher, discordRPC, autoUpdater).build()
        )

        root.center = tabPane
        root.bottom = buildStatusBar()

        return root
    }

    internal fun buildTopBar(): HBox {
        val bar = HBox(16.0)
        bar.styleClass.add("top-bar")
        bar.alignment = Pos.CENTER_LEFT
        bar.padding = Insets(12.0, 20.0, 12.0, 20.0)

        val logo = Label("⬡ NEXUS CLIENT")
        logo.styleClass.add("logo-label")

        val spacer = Region()
        HBox.setHgrow(spacer, Priority.ALWAYS)

        val userLabel = Label("Not logged in")
        userLabel.styleClass.add("user-label")
        userLabel.id = "user-label"

        bar.children.addAll(logo, spacer, userLabel)
        return bar
    }

    internal fun buildStatusBar(): HBox {
        val bar = HBox(12.0)
        bar.styleClass.add("status-bar")
        bar.padding = Insets(6.0, 16.0, 6.0, 16.0)
        bar.alignment = Pos.CENTER_LEFT

        val dot = Label("●")
        dot.styleClass.add("status-dot")

        statusLabel.styleClass.add("status-text")

        val spacer = Region()
        HBox.setHgrow(spacer, Priority.ALWAYS)

        val versionLabel = Label("Nexus Client v1.0.0")
        versionLabel.styleClass.add("version-label")

        bar.children.addAll(dot, statusLabel, spacer, versionLabel)
        return bar
    }

    fun setStatus(msg: String) {
        Platform.runLater { statusLabel.text = msg }
    }

    fun showAlert(title: String, message: String) {
        Platform.runLater {
            val alert = Alert(Alert.AlertType.ERROR)
            alert.title = title
            alert.contentText = message
            alert.showAndWait()
        }
    }

    internal fun checkForUpdates() {
        Thread {
            val update = autoUpdater.checkForUpdates()
            Platform.runLater {
                if (update.available) {
                    setStatus("Update available: ${update.latestVersion}")
                    val alert = Alert(Alert.AlertType.CONFIRMATION)
                    alert.title = "Update Available"
                    alert.headerText = "Nexus Client ${update.latestVersion} is available"
                    alert.contentText =
                        "Download and install the update?\n\n${update.releaseNotes.take(200)}"
                    alert.showAndWait().ifPresent { bt ->
                        if (bt == ButtonType.OK) {
                            Thread {
                                val file = autoUpdater.downloadUpdate(update) { p, msg ->
                                    Platform.runLater { setStatus("[$p%] $msg") }
                                }
                                if (file != null) {
                                    Platform.runLater { autoUpdater.applyUpdate(file) }
                                }
                            }.start()
                        }
                    }
                }
            }
        }.start()
    }

    override fun stop() {
        discordRPC.disconnect()
    }
}
