## Application settings (persisted to ~/Library/Application Support/DingoNote/config.json).

import std/[json, os]

type
  Config* = object
    vaultPath*: string

proc defaultVaultPath*(): string =
  getHomeDir() / "Documents" / "Note"

proc configDir*(): string =
  result = getHomeDir() / "Library" / "Application Support" / "DingoNote"
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
  writeFile(configPath(), $j)
