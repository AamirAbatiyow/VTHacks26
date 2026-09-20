import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
// tsc emits this module to server/dist/server/src; runtime assets stay in server/.
export const serverRoot = path.resolve(here, here.includes(`${path.sep}dist${path.sep}`) ? "../../.." : "..");
export const projectRoot = path.dirname(serverRoot);
