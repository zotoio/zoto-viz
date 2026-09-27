## Revert proof

| row | test | revert description | command | result |
| --- | --- | --- | --- | --- |
| host-mesh-clear-no-dispose | | | | **ERROR: row host-mesh-clear-no-dispose: baseline test selection failed (target not found; never a pass) --- baseline output --- failed to load config from <tmp>  ⎯⎯⎯⎯⎯⎯⎯ Startup Error ⎯⎯⎯⎯⎯⎯⎯⎯ TypeError [ERR_UNKNOWN_FILE_EXTENSION]: Unknown file extension ".ts" for <tmp>     at Object.getFileProtocolModuleFormat [as file:] (node:internal/modules/esm/get_format:219:9)     at defaultGetFormat (node:internal/modules/esm/get_format:245:36)     at defaultLoad (node:internal/modules/esm/load:120:22)     at async ModuleLoader.loadAndTranslate (node:internal/modules/esm/loader:514:32)     at async ModuleJob._link (node:internal/modules/esm/module_job:115:19) {   code: 'ERR_UNKNOWN_FILE_EXTENSION' }** |
