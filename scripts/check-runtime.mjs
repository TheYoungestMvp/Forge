if (
  Number(process.versions.node.split(".")[0]) !== 24 ||
  typeof WebSocket !== "function"
) {
  console.error(
    "Forge requires Node.js 24 with native WebSocket. Switch to Node.js 24 before installing or running the app.",
  );
  process.exit(1);
}
