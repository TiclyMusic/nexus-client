package com.nexus.client.ui

import com.nexus.client.auth.MicrosoftAuthenticator
import com.nexus.client.launcher.MinecraftLauncher
import com.nexus.client.launcher.ModLoader
import com.nexus.client.launcher.NexusMode
import com.nexus.client.launcher.VersionManager
import com.nexus.client.mods.ModManager
import com.nexus.client.mods.ModrinthAPI
import com.nexus.client.switch.NexusSwitch
import javafx.application.Platform
import javafx.geometry.Insets
import javafx.geometry.Pos
import javafx.scene.control.*
import javafx.scene.layout.*

class LauncherTab(
    private val window: MainWindow,
    private val versionManager: VersionManager,
    private val launcher: MinecraftLauncher,
    private val nexusSwitch: NexusSwitch,
    private val modManager: ModManager,
    private val modrinthAPI: ModrinthAPI
) {

    fun build(): Tab {
        val tab = Tab("🚀  Launch")

        val content = VBox(20.0)
        content.styleClass.add("tab-content")
        content.padding = Insets(24.0)
        content.alignment = Pos.TOP_CENTER

        val versionBox = HBox(12.0)
        versionBox.alignment = Pos.CENTER_LEFT

        val versionLabel = Label("Version:")
        versionLabel.styleClass.add("field-label")

        val versionCombo = ComboBox<String>()
        versionCombo.styleClass.add("nexus-combo")
        versionCombo.items.addAll(VersionManager.SUPPORTED_VERSIONS)
        versionCombo.value = "1.20.4"
        versionCombo.prefWidth = 150.0

        val loaderLabel = Label("Mod Loader:")
        loaderLabel.styleClass.add("field-label")

        val loaderCombo = ComboBox<String>()
        loaderCombo.styleClass.add("nexus-combo")
        loaderCombo.items.addAll("Fabric", "Forge", "Vanilla")
        loaderCombo.value = "Fabric"
        loaderCombo.prefWidth = 120.0

        versionBox.children.addAll(versionLabel, versionCombo, loaderLabel, loaderCombo)

        val switchCard = buildNexusSwitchCard(versionCombo)
        val ramBox = buildRamSlider()
        val authBox = buildAuthSection()

        val buttonBox = HBox(12.0)
        buttonBox.alignment = Pos.CENTER

        val downloadBtn = Button("⬇ Download")
        downloadBtn.styleClass.addAll("nexus-button", "secondary-button")
        downloadBtn.setOnAction {
            val ver = versionCombo.value ?: return@setOnAction
            downloadVersion(ver)
        }

        val launchBtn = Button("▶  PLAY")
        launchBtn.styleClass.addAll("nexus-button", "primary-button")
        launchBtn.setOnAction {
            val ver = versionCombo.value ?: return@setOnAction
            val loader = when (loaderCombo.value) {
                "Forge" -> ModLoader.FORGE
                "Vanilla" -> ModLoader.VANILLA
                else -> ModLoader.FABRIC
            }
            launchGame(ver, loader)
        }

        buttonBox.children.addAll(downloadBtn, launchBtn)
        content.children.addAll(versionBox, switchCard, ramBox, authBox, buttonBox)

        val scroll = ScrollPane(content)
        scroll.isFitToWidth = true
        scroll.styleClass.add("transparent-scroll")
        tab.content = scroll
        return tab
    }

    private fun buildNexusSwitchCard(versionCombo: ComboBox<String>): VBox {
        val card = VBox(10.0)
        card.styleClass.add("switch-card")
        card.padding = Insets(16.0)
        card.maxWidth = 500.0

        val titleLabel = Label("⚡ NEXUS SWITCH")
        titleLabel.styleClass.add("card-title")

        val descLabel = Label("Toggle between Clean and Enhanced mode")
        descLabel.styleClass.add("card-desc")

        val switchRow = HBox(16.0)
        switchRow.alignment = Pos.CENTER

        val modeLabel = Label("Mode: Clean ⬜")
        modeLabel.styleClass.add("mode-label")
        modeLabel.id = "mode-label"

        val toggleBtn = Button("Switch Mode")
        toggleBtn.styleClass.addAll("nexus-button", "switch-button")
        toggleBtn.setOnAction {
            val ver = versionCombo.value ?: "1.20.4"
            val newMode = nexusSwitch.toggle(ver)
            modeLabel.text = "Mode: ${nexusSwitch.getModeLabel(newMode)}"
            modeLabel.styleClass.removeAll("mode-clean", "mode-enhanced")
            if (newMode == NexusMode.ENHANCED) {
                modeLabel.styleClass.add("mode-enhanced")
            } else {
                modeLabel.styleClass.add("mode-clean")
            }
            window.setStatus("Switched to ${newMode.name} mode for $ver")
        }

        switchRow.children.addAll(modeLabel, toggleBtn)
        card.children.addAll(titleLabel, descLabel, switchRow)
        return card
    }

    private fun buildRamSlider(): VBox {
        val box = VBox(6.0)

        val label = Label("RAM Allocation: 2048 MB")
        label.styleClass.add("field-label")

        val slider = Slider(512.0, 8192.0, 2048.0)
        slider.styleClass.add("ram-slider")
        slider.isShowTickLabels = true
        slider.isShowTickMarks = true
        slider.majorTickUnit = 1024.0
        slider.prefWidth = 400.0
        slider.blockIncrement = 256.0

        slider.valueProperty().addListener { _, _, newVal ->
            val ram = (newVal.toInt() / 256) * 256
            label.text = "RAM Allocation: $ram MB"
        }

        box.children.addAll(label, slider)
        return box
    }

    private fun buildAuthSection(): VBox {
        val box = VBox(8.0)
        box.styleClass.add("auth-section")
        box.padding = Insets(12.0)

        val titleLabel = Label("Microsoft Account")
        titleLabel.styleClass.add("section-title")

        val authRow = HBox(12.0)
        authRow.alignment = Pos.CENTER_LEFT

        val authStatus = Label("Not authenticated")
        authStatus.styleClass.add("auth-status")
        authStatus.id = "auth-status"

        val loginBtn = Button("Login with Microsoft")
        loginBtn.styleClass.addAll("nexus-button", "auth-button")
        loginBtn.setOnAction { showAuthDialog() }

        authRow.children.addAll(authStatus, loginBtn)
        box.children.addAll(titleLabel, authRow)
        return box
    }

    private fun launchGame(versionId: String, modLoader: ModLoader) {
        val profile = window.currentProfile
        if (profile == null) {
            window.showAlert("Not Authenticated", "Please login with your Microsoft account first.")
            return
        }

        window.setStatus("Launching Minecraft $versionId...")

        val config = MinecraftLauncher.LaunchConfig(
            versionId = versionId,
            modLoader = modLoader,
            nexusMode = nexusSwitch.getCurrentMode(versionId),
            profile = profile
        )

        Thread {
            try {
                launcher.launch(config)
                Platform.runLater { window.setStatus("Minecraft launched!") }
            } catch (e: Exception) {
                Platform.runLater {
                    window.setStatus("Launch failed: ${e.message}")
                    window.showAlert("Launch Failed", e.message ?: "Unknown error")
                }
            }
        }.start()
    }

    private fun downloadVersion(versionId: String) {
        window.setStatus("Downloading $versionId...")
        Thread {
            try {
                launcher.downloadVersion(versionId) { progress, msg ->
                    Platform.runLater { window.setStatus("[$progress%] $msg") }
                }
                Platform.runLater { window.setStatus("$versionId downloaded successfully!") }
            } catch (e: Exception) {
                Platform.runLater { window.setStatus("Download failed: ${e.message}") }
            }
        }.start()
    }

    private fun showAuthDialog() {
        val dialog = Dialog<String>()
        dialog.title = "Microsoft Authentication"
        dialog.headerText = "Login with Microsoft Account"

        val content = VBox(12.0)
        content.padding = Insets(16.0)

        val instructions = Label(
            "1. Click 'Open Browser' to login with Microsoft\n" +
                "2. After login, copy the auth code from the URL\n" +
                "3. Paste it below and click Confirm"
        )
        instructions.styleClass.add("auth-instructions")

        val codeField = TextField()
        codeField.promptText = "Paste auth code here..."
        codeField.styleClass.add("nexus-input")

        val openBrowserBtn = Button("Open Browser")
        openBrowserBtn.styleClass.addAll("nexus-button", "secondary-button")
        openBrowserBtn.setOnAction {
            try {
                val auth = MicrosoftAuthenticator()
                val url = auth.getAuthUrl()
                java.awt.Desktop.getDesktop().browse(java.net.URI(url))
            } catch (e: Exception) {
                window.setStatus("Could not open browser: ${e.message}")
            }
        }

        content.children.addAll(instructions, openBrowserBtn, codeField)
        dialog.dialogPane.content = content

        val css = javaClass.getResource("/com/nexus/client/style.css")
        if (css != null) dialog.dialogPane.scene?.stylesheets?.add(css.toExternalForm())

        dialog.dialogPane.buttonTypes.addAll(ButtonType.OK, ButtonType.CANCEL)
        dialog.setResultConverter { bt -> if (bt == ButtonType.OK) codeField.text else null }

        val result = dialog.showAndWait()
        result.ifPresent { code ->
            if (code.isNotBlank()) {
                window.setStatus("Authenticating...")
                Thread {
                    try {
                        val auth = MicrosoftAuthenticator()
                        val profile = auth.authenticate(code)
                        Platform.runLater {
                            window.currentProfile = profile
                            window.setStatus("Logged in as ${profile.username}")
                        }
                    } catch (e: Exception) {
                        Platform.runLater {
                            window.setStatus("Authentication failed: ${e.message}")
                            window.showAlert("Auth Failed", e.message ?: "Unknown error")
                        }
                    }
                }.start()
            }
        }
    }
}
