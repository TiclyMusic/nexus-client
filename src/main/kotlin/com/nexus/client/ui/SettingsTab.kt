package com.nexus.client.ui

import com.nexus.client.launcher.MinecraftLauncher
import com.nexus.client.launcher.VersionManager
import com.nexus.client.social.DiscordRPCManager
import com.nexus.client.update.AutoUpdater
import javafx.geometry.Insets
import javafx.geometry.Pos
import javafx.scene.control.*
import javafx.scene.layout.*

class SettingsTab(
    private val window: MainWindow,
    private val versionManager: VersionManager,
    private val launcher: MinecraftLauncher,
    private val discordRPC: DiscordRPCManager,
    private val autoUpdater: AutoUpdater
) {

    fun build(): Tab {
        val tab = Tab("⚙  Settings")

        val content = VBox(20.0)
        content.styleClass.add("tab-content")
        content.padding = Insets(24.0)

        val jvmSection = VBox(8.0)
        val jvmTitle = Label("JVM Arguments")
        jvmTitle.styleClass.add("section-title")
        val jvmField = TextArea(MinecraftLauncher.defaultJvmArgs().joinToString("\n"))
        jvmField.styleClass.add("nexus-textarea")
        jvmField.prefHeight = 120.0
        jvmSection.children.addAll(jvmTitle, jvmField)

        val discordSection = HBox(12.0)
        discordSection.alignment = Pos.CENTER_LEFT
        val discordLabel = Label("Discord Rich Presence")
        discordLabel.styleClass.add("field-label")
        val discordToggle = CheckBox()
        discordToggle.isSelected = true
        discordToggle.setOnAction {
            if (discordToggle.isSelected) {
                Thread { discordRPC.connect(); discordRPC.setInLauncher() }.start()
            } else {
                discordRPC.disconnect()
            }
        }
        discordSection.children.addAll(discordToggle, discordLabel)

        val dirSection = VBox(6.0)
        val dirTitle = Label("Nexus Directory")
        dirTitle.styleClass.add("section-title")
        val dirLabel = Label(versionManager.getNexusDir().toString())
        dirLabel.styleClass.add("path-label")
        dirSection.children.addAll(dirTitle, dirLabel)

        val updateSection = HBox(12.0)
        updateSection.alignment = Pos.CENTER_LEFT
        val updateLabel = Label("Check for Updates")
        updateLabel.styleClass.add("field-label")
        val updateBtn = Button("Check Now")
        updateBtn.styleClass.addAll("nexus-button", "secondary-button")
        updateBtn.setOnAction { window.checkForUpdates() }
        updateSection.children.addAll(updateBtn, updateLabel)

        val saveBtn = Button("💾 Save Settings")
        saveBtn.styleClass.addAll("nexus-button", "primary-button")
        saveBtn.setOnAction { window.setStatus("Settings saved") }

        content.children.addAll(jvmSection, discordSection, dirSection, updateSection, saveBtn)

        val scroll = ScrollPane(content)
        scroll.isFitToWidth = true
        scroll.styleClass.add("transparent-scroll")
        tab.content = scroll
        return tab
    }
}
