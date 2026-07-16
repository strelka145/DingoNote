## Application settings persisted to a per-OS config directory:
##   macOS:   ~/Library/Application Support/DingoNote/config.json
##   Linux:   $XDG_CONFIG_HOME/DingoNote/config.json  (or ~/.config/DingoNote/)
##   Windows: %APPDATA%/DingoNote/config.json         (or ~/AppData/Roaming/)

import std/[json, os, oids]

proc atomicWrite*(path, content: string) =
  ## Write `content` to `path` durably: write to a temp file in the same
  ## directory, then rename it over the target. A rename is atomic on a single
  ## filesystem, so a crash or power loss mid-write can't leave a truncated or
  ## corrupt file — readers see either the old file or the fully-written new one.
  ## (Lives in config.nim, the lowest-level module, so storage.nim can reuse it.)
  let tmp = path.parentDir / ("." & path.extractFilename & "." & $genOid() & ".tmp")
  writeFile(tmp, content)
  moveFile(tmp, path)

type
  Config* = object
    vaultPath*: string

proc defaultVaultPath*(): string =
  getHomeDir() / "Documents" / "Note"

proc configDir*(): string =
  when defined(macosx):
    result = getHomeDir() / "Library" / "Application Support" / "DingoNote"
  elif defined(windows):
    let appdata = getEnv("APPDATA")
    let base =
      if appdata.len > 0: appdata
      else: getHomeDir() / "AppData" / "Roaming"
    result = base / "DingoNote"
  else:
    let xdg = getEnv("XDG_CONFIG_HOME")
    let base = if xdg.len > 0: xdg else: getHomeDir() / ".config"
    result = base / "DingoNote"
  createDir(result)

proc configPath*(): string = configDir() / "config.json"

proc loadConfig*(): Config =
  result.vaultPath = defaultVaultPath()
  let p = configPath()
  if not fileExists(p): return
  try:
    let j = parseJson(readFile(p))
    if j.hasKey("vaultPath"):
      let s = j["vaultPath"].getStr()
      if s.len > 0: result.vaultPath = expandTilde(s)
  except CatchableError: discard

proc saveConfig*(c: Config) =
  let j = %* {"vaultPath": c.vaultPath}
  atomicWrite(configPath(), $j)
