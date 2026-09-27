/** Config keys declared in plugin.yml — parse only these via config.read. */
export const VOX_CONFIG_KEYS = [
  "preset", "seed", "biome", "viewDist", "timeOfDay", "cycleSpeed", "weather", "camera", "cameraSpeed",
  "fog", "textureStyle", "mobs", "clouds", "palette", "reducedMotion",
  "cap_maxChunks", "cap_maxViewDist", "cap_vertexBudget", "cap_maxMobs", "cap_chunksPerFrame",
  "bind_sysLoad_weather", "bind_eventRate_cloudCover", "bind_packetField_torch", "bind_packetField_block",
  "bind_sysFailed_failBeacon",
] as const;

export type VoxConfigKey = (typeof VOX_CONFIG_KEYS)[number];

export const VOX_LIVE_BIND_KEYS = [
  "bind_sysLoad_weather",
  "bind_eventRate_cloudCover",
  "bind_packetField_torch",
  "bind_packetField_block",
  "bind_sysFailed_failBeacon",
] as const;
