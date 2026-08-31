import fs from "node:fs";

const source = fs.readFileSync(new URL("../js/core/EndingManager.js", import.meta.url), "utf8");
if (/itemManager\.has/.test(source) && !/import\s+\{\s*itemManager\s*\}\s+from\s+["']\.\/ItemManager\.js/.test(source)) {
  throw new Error("EndingManager uses itemManager without a direct import");
}
console.log("ending requirements dependency probe passed");
