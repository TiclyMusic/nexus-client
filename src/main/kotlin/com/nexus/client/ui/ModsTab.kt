package com.nexus.client.ui

import com.nexus.client.launcher.VersionManager
import com.nexus.client.mods.ModrinthAPI
import javafx.application.Platform
import javafx.geometry.Insets
import javafx.geometry.Pos
import javafx.scene.control.*
import javafx.scene.layout.*

class ModsTab(
    private val window: MainWindow,
    private val versionManager: VersionManager,
    private val modrinthAPI: ModrinthAPI
) {

    fun build(): Tab {
        val tab = Tab("🧩  Mods")

        val content = VBox(16.0)
        content.styleClass.add("tab-content")
        content.padding = Insets(24.0)

        val searchRow = HBox(12.0)
        searchRow.alignment = Pos.CENTER_LEFT

        val searchField = TextField()
        searchField.promptText = "Search Modrinth..."
        searchField.styleClass.add("nexus-input")
        searchField.prefWidth = 300.0
        HBox.setHgrow(searchField, Priority.ALWAYS)

        val versionFilter = ComboBox<String>()
        versionFilter.styleClass.add("nexus-combo")
        versionFilter.items.add("All")
        versionFilter.items.addAll(VersionManager.SUPPORTED_VERSIONS)
        versionFilter.value = "All"
        versionFilter.prefWidth = 110.0

        val loaderFilter = ComboBox<String>()
        loaderFilter.styleClass.add("nexus-combo")
        loaderFilter.items.addAll("All", "fabric", "forge")
        loaderFilter.value = "All"
        loaderFilter.prefWidth = 100.0

        val searchBtn = Button("🔍 Search")
        searchBtn.styleClass.addAll("nexus-button", "secondary-button")

        searchRow.children.addAll(searchField, versionFilter, loaderFilter, searchBtn)

        val resultsList = ListView<String>()
        resultsList.styleClass.add("mods-list")
        resultsList.prefHeight = 350.0

        val installBtn = Button("⬇ Install Selected")
        installBtn.styleClass.addAll("nexus-button", "primary-button")
        installBtn.isDisable = true

        val doSearch = {
            val query = searchField.text.trim()
            if (query.isNotEmpty()) {
                searchMods(query, versionFilter.value, loaderFilter.value, resultsList, installBtn)
            }
        }

        searchBtn.setOnAction { doSearch() }
        searchField.setOnAction { doSearch() }

        content.children.addAll(searchRow, resultsList, installBtn)

        val scroll = ScrollPane(content)
        scroll.isFitToWidth = true
        scroll.styleClass.add("transparent-scroll")
        tab.content = scroll
        return tab
    }

    private fun searchMods(
        query: String,
        gameVersion: String,
        loader: String,
        resultsList: ListView<String>,
        installBtn: Button
    ) {
        window.setStatus("Searching Modrinth for '$query'...")
        resultsList.items.clear()
        installBtn.isDisable = true

        val gv = if (gameVersion == "All") null else gameVersion
        val ldr = if (loader == "All") null else loader

        Thread {
            try {
                val results = modrinthAPI.searchMods(query, gv, ldr)
                Platform.runLater {
                    results.hits.forEach { mod ->
                        resultsList.items.add(
                            "${mod.title} — ${mod.description.take(60)}... [↓${mod.downloads}]"
                        )
                    }
                    installBtn.isDisable = results.hits.isEmpty()
                    window.setStatus("Found ${results.totalHits} mods")
                }
            } catch (e: Exception) {
                Platform.runLater { window.setStatus("Search failed: ${e.message}") }
            }
        }.start()
    }
}
