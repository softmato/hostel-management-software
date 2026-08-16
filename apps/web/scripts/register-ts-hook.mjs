/** Installs `ts-resolve-hook.mjs`. See that file for why it exists. */
import { register } from "node:module";
import { pathToFileURL } from "node:url";

register("./ts-resolve-hook.mjs", pathToFileURL(import.meta.filename));
