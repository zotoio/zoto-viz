/** Route @typescript-eslint/parser to TypeScript 6.9 (parser peer) while the app builds on TS 7. */
const Module = require("module");
const path = require("path");

const ts6Root = path.dirname(require.resolve("ts6/package.json"));
const ts6Entry = path.join(ts6Root, "lib/typescript.js");

const original = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
  if (request === "typescript" && parent?.filename) {
    const from = parent.filename;
    if (
      from.includes("@typescript-eslint")
      || from.includes("ts-api-utils")
      || from.includes(`${path.sep}eslint${path.sep}`)
    ) {
      return ts6Entry;
    }
  }
  return original.call(this, request, parent, isMain, options);
};
