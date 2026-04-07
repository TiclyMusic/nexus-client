package com.nexus.client.auth

import com.google.gson.Gson
import com.google.gson.JsonObject
import okhttp3.FormBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody

data class MinecraftProfile(
    val username: String,
    val uuid: String,
    val accessToken: String
)

class MicrosoftAuthenticator {
    private val client = OkHttpClient()
    private val gson = Gson()

    // Microsoft Azure App Client ID (public Minecraft launcher client id)
    private val clientId = "00000000402b5328"
    private val redirectUri = "https://login.live.com/oauth20_desktop.srf"

    fun getAuthUrl(): String {
        return "https://login.live.com/oauth20_authorize.srf" +
            "?client_id=$clientId" +
            "&response_type=code" +
            "&redirect_uri=${java.net.URLEncoder.encode(redirectUri, "UTF-8")}" +
            "&scope=XboxLive.signin%20offline_access"
    }

    fun authenticate(authCode: String): MinecraftProfile {
        val msToken = exchangeCodeForToken(authCode)
        val xblToken = authenticateWithXBL(msToken)
        val xstsToken = getXSTSToken(xblToken.first)
        val mcToken = getMinecraftToken(xstsToken, xblToken.second)
        return getMinecraftProfile(mcToken)
    }

    private fun exchangeCodeForToken(code: String): String {
        val body = FormBody.Builder()
            .add("client_id", clientId)
            .add("code", code)
            .add("grant_type", "authorization_code")
            .add("redirect_uri", redirectUri)
            .build()

        val request = Request.Builder()
            .url("https://login.live.com/oauth20_token.srf")
            .post(body)
            .build()

        val response = client.newCall(request).execute()
        val json = gson.fromJson(response.body!!.string(), JsonObject::class.java)
        return json.get("access_token").asString
    }

    private fun authenticateWithXBL(msToken: String): Pair<String, String> {
        val payload = """
            {
                "Properties": {
                    "AuthMethod": "RPS",
                    "SiteName": "user.auth.xboxlive.com",
                    "RpsTicket": "d=$msToken"
                },
                "RelyingParty": "http://auth.xboxlive.com",
                "TokenType": "JWT"
            }
        """.trimIndent()

        val request = Request.Builder()
            .url("https://user.auth.xboxlive.com/user/authenticate")
            .post(payload.toRequestBody("application/json".toMediaType()))
            .header("Accept", "application/json")
            .build()

        val response = client.newCall(request).execute()
        val json = gson.fromJson(response.body!!.string(), JsonObject::class.java)
        val token = json.get("Token").asString
        val userHash = json.getAsJsonObject("DisplayClaims")
            .getAsJsonArray("xui").get(0).asJsonObject
            .get("uhs").asString
        return Pair(token, userHash)
    }

    private fun getXSTSToken(xblToken: String): String {
        val payload = """
            {
                "Properties": {
                    "SandboxId": "RETAIL",
                    "UserTokens": ["$xblToken"]
                },
                "RelyingParty": "rp://api.minecraftservices.com/",
                "TokenType": "JWT"
            }
        """.trimIndent()

        val request = Request.Builder()
            .url("https://xsts.auth.xboxlive.com/xsts/authorize")
            .post(payload.toRequestBody("application/json".toMediaType()))
            .header("Accept", "application/json")
            .build()

        val response = client.newCall(request).execute()
        val json = gson.fromJson(response.body!!.string(), JsonObject::class.java)
        return json.get("Token").asString
    }

    private fun getMinecraftToken(xstsToken: String, userHash: String): String {
        val payload = """{"identityToken": "XBL3.0 x=$userHash;$xstsToken"}"""

        val request = Request.Builder()
            .url("https://api.minecraftservices.com/authentication/login_with_xbox")
            .post(payload.toRequestBody("application/json".toMediaType()))
            .build()

        val response = client.newCall(request).execute()
        val json = gson.fromJson(response.body!!.string(), JsonObject::class.java)
        return json.get("access_token").asString
    }

    private fun getMinecraftProfile(mcToken: String): MinecraftProfile {
        val request = Request.Builder()
            .url("https://api.minecraftservices.com/minecraft/profile")
            .header("Authorization", "Bearer $mcToken")
            .build()

        val response = client.newCall(request).execute()
        val json = gson.fromJson(response.body!!.string(), JsonObject::class.java)
        return MinecraftProfile(
            username = json.get("name").asString,
            uuid = json.get("id").asString,
            accessToken = mcToken
        )
    }
}
