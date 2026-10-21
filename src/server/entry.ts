import { networkInterfaces } from "node:os";
import { createGameServer } from "./server";
const lan = process.argv.includes("--lan");
const app = await createGameServer({
  host: lan ? "0.0.0.0" : "127.0.0.1",
  port: 8903,
});
console.log("墨绘战场服务器已启动：http://127.0.0.1:" + app.port);
if (lan) {
  for (const entries of Object.values(networkInterfaces()))
    for (const entry of entries ?? [])
      if (entry.family === "IPv4" && !entry.internal)
        console.log(`局域网：http://${entry.address}:${app.port}`);
  console.log(
    "其他电脑无法连接时：确认同一局域网、Windows 网络类型为专用，并在 Windows 防火墙中允许 Node.js 在专用网络通信。不要关闭防火墙或开放公共网络。",
  );
}
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    void app.close().then(() => process.exit(0));
  });
