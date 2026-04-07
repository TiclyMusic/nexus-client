# Nexus Client

A custom Minecraft launcher inspired by Lunar Client, built with Kotlin and JavaFX.

## Features

- 🚀 **Multi-Version Support**: Download and launch Minecraft 1.8.9 through 1.20.x
- 🧩 **Modrinth Integration**: Search and install mods directly from Modrinth
- ⚡ **Nexus Switch**: Toggle between Clean and Enhanced mod profiles instantly
- 🎮 **Discord Rich Presence**: Show your game status to friends
- 🔄 **Auto-Updater**: Automatic updates from GitHub releases
- 🎨 **Modern UI**: Dark theme inspired by Lunar/Badlion Client
- 🔐 **Microsoft Auth**: OAuth2 authentication with Microsoft/Xbox Live

## Requirements

- Java 17+
- Gradle 8+

## Build

```bash
./gradlew build
```

## Run

```bash
./gradlew run
```

## Test

```bash
./gradlew test
```

## Architecture

```
src/main/kotlin/com/nexus/client/
├── auth/           # Microsoft OAuth2 authentication
├── launcher/       # Version management & game launching
├── mods/           # Modrinth API & mod management
├── switch/         # Nexus Switch (Clean/Enhanced mode)
├── social/         # Discord RPC integration
├── update/         # Auto-updater
└── ui/             # JavaFX UI components
```

## Nexus Switch

The Nexus Switch allows you to quickly toggle between two mod profiles:
- **Clean**: Standard gameplay with your chosen mods
- **Enhanced**: Optimized utility mods for enhanced gameplay (optimization + QoL mods)

## Discord Rich Presence

Requires Discord to be running on your machine. The launcher will automatically
connect to Discord's IPC socket.

> **Platform note**: Discord Rich Presence via Unix socket is supported on **Linux** and
> **macOS**. Windows uses named pipes which require native library support (not included
> in this build). A valid Discord application ID must be provided via the
> `DiscordRPCManager` constructor — register your app at
> <https://discord.com/developers/applications>.

## Configuration

| Setting | Default | Description |
|---|---|---|
| Discord App ID | — | Required. Set in `DiscordRPCManager` constructor |
| Nexus directory | `~/.nexus-client` | Per-OS default; customizable via `VersionManager` |
| RAM allocation | 2048 MB | Adjustable in the Settings slider |