package com.nexus.client.mods

import com.google.gson.Gson
import com.google.gson.JsonObject
import com.google.gson.JsonArray
import okhttp3.OkHttpClient
import okhttp3.Request
import java.net.URLEncoder

data class ModrinthMod(
    val id: String,
    val slug: String,
    val title: String,
    val description: String,
    val categories: List<String>,
    val clientSide: String,
    val serverSide: String,
    val downloads: Long,
    val iconUrl: String?,
    val projectType: String,
    val versions: List<String> = emptyList()
)

data class ModrinthVersion(
    val id: String,
    val projectId: String,
    val name: String,
    val versionNumber: String,
    val gameVersions: List<String>,
    val loaders: List<String>,
    val files: List<ModrinthFile>,
    val dependencies: List<ModrinthDependency>
)

data class ModrinthFile(
    val url: String,
    val filename: String,
    val primary: Boolean,
    val size: Long
)

data class ModrinthDependency(
    val projectId: String?,
    val versionId: String?,
    val dependencyType: String
)

data class SearchResult(
    val hits: List<ModrinthMod>,
    val offset: Int,
    val limit: Int,
    val totalHits: Int
)

class ModrinthAPI {
    private val client = OkHttpClient()
    private val gson = Gson()
    private val baseUrl = "https://api.modrinth.com/v2"
    private val userAgent = "NexusClient/1.0.0 (github.com/matthias-peterlini/Nexus-client)"

    fun searchMods(
        query: String,
        gameVersion: String? = null,
        loader: String? = null,
        limit: Int = 20,
        offset: Int = 0
    ): SearchResult {
        val facets = buildList {
            if (gameVersion != null) add("""["versions:$gameVersion"]""")
            if (loader != null) add("""["categories:$loader"]""")
            add("""["project_type:mod"]""")
        }

        val facetsParam = if (facets.isNotEmpty())
            "&facets=[${facets.joinToString(",")}]"
        else ""

        val encodedQuery = URLEncoder.encode(query, "UTF-8")
        val url = "$baseUrl/search?query=$encodedQuery&limit=$limit&offset=$offset$facetsParam"

        val json = doGet(url)
        val hits = json.getAsJsonArray("hits").map { el ->
            val obj = el.asJsonObject
            ModrinthMod(
                id = obj.get("project_id").asString,
                slug = obj.get("slug").asString,
                title = obj.get("title").asString,
                description = obj.get("description").asString,
                categories = obj.getAsJsonArray("categories").map { it.asString },
                clientSide = obj.get("client_side")?.asString ?: "unknown",
                serverSide = obj.get("server_side")?.asString ?: "unknown",
                downloads = obj.get("downloads")?.asLong ?: 0L,
                iconUrl = obj.get("icon_url")?.let { if (it.isJsonNull) null else it.asString },
                projectType = obj.get("project_type")?.asString ?: "mod"
            )
        }

        return SearchResult(
            hits = hits,
            offset = json.get("offset").asInt,
            limit = json.get("limit").asInt,
            totalHits = json.get("total_hits").asInt
        )
    }

    fun getMod(projectId: String): ModrinthMod {
        val json = doGet("$baseUrl/project/$projectId")
        return ModrinthMod(
            id = json.get("id").asString,
            slug = json.get("slug").asString,
            title = json.get("title").asString,
            description = json.get("description").asString,
            categories = json.getAsJsonArray("categories").map { it.asString },
            clientSide = json.get("client_side")?.asString ?: "unknown",
            serverSide = json.get("server_side")?.asString ?: "unknown",
            downloads = json.get("downloads")?.asLong ?: 0L,
            iconUrl = json.get("icon_url")?.let { if (it.isJsonNull) null else it.asString },
            projectType = json.get("project_type")?.asString ?: "mod",
            versions = json.getAsJsonArray("versions").map { it.asString }
        )
    }

    fun getVersions(
        projectId: String,
        gameVersion: String? = null,
        loader: String? = null
    ): List<ModrinthVersion> {
        var url = "$baseUrl/project/$projectId/version"
        val params = buildList {
            if (gameVersion != null) add("game_versions=[\"$gameVersion\"]")
            if (loader != null) add("loaders=[\"$loader\"]")
        }
        if (params.isNotEmpty()) url += "?" + params.joinToString("&")

        val array = doGetArray(url)
        return array.map { el ->
            val obj = el.asJsonObject
            ModrinthVersion(
                id = obj.get("id").asString,
                projectId = obj.get("project_id").asString,
                name = obj.get("name").asString,
                versionNumber = obj.get("version_number").asString,
                gameVersions = obj.getAsJsonArray("game_versions").map { it.asString },
                loaders = obj.getAsJsonArray("loaders").map { it.asString },
                files = obj.getAsJsonArray("files").map { f ->
                    val fo = f.asJsonObject
                    ModrinthFile(
                        url = fo.get("url").asString,
                        filename = fo.get("filename").asString,
                        primary = fo.get("primary").asBoolean,
                        size = fo.get("size").asLong
                    )
                },
                dependencies = obj.getAsJsonArray("dependencies").map { d ->
                    val dep = d.asJsonObject
                    ModrinthDependency(
                        projectId = dep.get("project_id")?.let { if (it.isJsonNull) null else it.asString },
                        versionId = dep.get("version_id")?.let { if (it.isJsonNull) null else it.asString },
                        dependencyType = dep.get("dependency_type").asString
                    )
                }
            )
        }
    }

    private fun doGet(url: String): JsonObject {
        val request = Request.Builder()
            .url(url)
            .header("User-Agent", userAgent)
            .build()
        val response = client.newCall(request).execute()
        if (!response.isSuccessful) throw RuntimeException("HTTP ${response.code}: $url")
        return gson.fromJson(response.body!!.string(), JsonObject::class.java)
    }

    private fun doGetArray(url: String): JsonArray {
        val request = Request.Builder()
            .url(url)
            .header("User-Agent", userAgent)
            .build()
        val response = client.newCall(request).execute()
        if (!response.isSuccessful) throw RuntimeException("HTTP ${response.code}: $url")
        return gson.fromJson(response.body!!.string(), JsonArray::class.java)
    }
}
