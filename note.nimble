version       = "0.1.0"
author        = "strelka"
description   = "A note app using webview + Svelte"
license       = "MIT"
srcDir        = "src"
bin           = @["note"]
backend       = "cpp"

requires "nim >= 2.0.0"

# Unit tests. cpp backend to match nim.cfg's C++ passC flags.
task test, "Run unit tests":
  exec "nim cpp -r --hints:off --warnings:off tests/test_storage.nim"
