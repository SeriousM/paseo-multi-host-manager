# Paseo capability flags by release

Source: `server_info.features` boolean flags as declared in each stable `@getpaseo/protocol` release (0.6.0 to 0.14.0, extracted from the published npm packages on 2026-10-28 and 2026-10-29). At runtime the authoritative source is the connected daemon's own `server_info.features` (and `version`, `protocolVersion`, `capabilities`, `permissions`): gate on the flag, use this table only for messages and for hosts that do not report a flag.

| First stable release | Flags introduced |
| --- | --- |
| 0.8.0 | agentHistorySearch, agentRequestReceipts, agentTimelinePromptIndex, checkoutForgeSetAutoMerge, checkoutGithubSetAutoMerge, checkoutRefresh, daemonConfigReload, daemonStatusRpc, directorySync, forgeCheckDetails, forgeSearch, githubCheckDetails, hubAgentRpc, pluginGitManagement, pluginLogs, pluginManagement, pluginSettings, pluginThemes, pluginTimelineItems, plugins, projectAdd, projectRemove, providerUsageList, providersSnapshot, providersSnapshotCwd, pushTokenRevocation, relayConfig, rewind, skillManagement, terminal-input-mode-replay, terminal-restore-modes, terminal-size-ownership, workspaceFileEditing, workspaceLabels, workspaceMultiplicity, workspaceRecovery, workspaceSetupRun, workspaceTerminals, worktreeRestore |
| 0.9.0 | creationLifecycle, pluginSourceInstallation, pluginSourceUpdates, workspaceRequestReceipts |
| 0.11.0 | usageSources |
| 0.12.0 | backgroundWorkspaces, internalAgents, internalWorkspaces |
| 0.13.0 | connectedHosts, hostMultiplexing |
| 0.14.0 | idleRuntimeCleanupSetting, speechSettings, wholeTurnTimeline |

## Flags this plugin depends on

| Need | Flag | Since |
| --- | --- | --- |
| Broker can route to saved hosts | connectedHosts | 0.13.0 |
| Target reachable through a broker | hostMultiplexing | 0.13.0 |
| Plugins exist at all | plugins | 0.8.0 |
| List/enable/disable/remove plugins | pluginManagement | 0.8.0 |
| Install plugins from sources | pluginSourceInstallation | 0.9.0 |
| Preview/apply plugin updates | pluginSourceUpdates | 0.9.0 |
| Plugin settings documents | pluginSettings | 0.8.0 |
| Plugin logs | pluginLogs | 0.8.0 |
| Config reload without restart | daemonConfigReload | 0.8.0 |
| Relay configuration RPC | relayConfig | 0.8.0 |
| Daemon status RPC | daemonStatusRpc | 0.8.0 |
| Write the "Release idle agent runtimes" row (`config.patch` key `idleRuntimeCleanup`) | idleRuntimeCleanupSetting | 0.14.0 |

The 0.14.0 server source comments `idleRuntimeCleanupSetting` as added in 0.13.0, but the 0.13.0 to 0.13.2 protocol packages do not declare it and a 0.13.2 daemon ignores the key (ROWS.md). The flag, not the version, decides. Nothing was removed or renamed between 0.13.2 and 0.14.0.
