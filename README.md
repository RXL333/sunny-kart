# 晴空卡丁车 · SUNNY KART

原创卡通海岛竞速游戏，电脑网页端。0.2 版赛道长约 2.14 公里，有海岸、森林、山道、海湾大桥和港镇五个区域，可从主菜单“航拍全图”查看。核心玩法是漂移蓄力与氮气；轻度碰撞推挤、减速，不翻车。支持单人对 AI 和 2–8 人好友房间，不含攻击道具。

## 开始游戏

[在线游玩 · GitHub Pages](https://rxl333.github.io/sunny-kart/) · [项目源码](https://github.com/RXL333/sunny-kart)

Windows 双击 **启动游戏.cmd**，浏览器会打开 `http://localhost:3001`。需要已安装 Node.js；本机已经安装。首次缺少依赖时脚本会运行 npm ci。脚本在后台启动游戏服务，日志位于 logs/。

也可在项目目录运行：

```powershell
npm ci
npm run build
npm start
```

开发时分别运行 `npm run dev` 和 `npm run dev:server`，浏览器访问 Vite 显示的 5173 地址。修改源码后需重新 `npm run build` 才会反映到 3001 生产页面。

## 操作

| 按键 | 动作 |
| --- | --- |
| W / ↑ | 油门 |
| S / ↓ | 制动 |
| A D / ← → | 左右转向 |
| Shift + 转向 | 漂移蓄力，松开后小喷并补氮；反向转向可以收回侧滑 |
| Space / N | 持续释放氮气 |
| Q | 自动油门开关 |
| Esc | 单人暂停 / 继续 |
| R | 单人重新比赛 |

赛道上的金色晶体补充氮气，青色箭头加速带提供短时加速。每场三圈，七位 AI 补齐八车。

## 好友联机

同一局域网的朋友用浏览器访问这台电脑的局域网 IP，例如 `http://电脑的局域网IP:3001`。一人点击“好友联机 → 创建房间”，其他人输入六位房间码，至少两人加入后房主开始。使用相同服务地址才能看到同一个房间。系统防火墙如阻拦需由用户允许该服务在对应网络通信。

服务器 60Hz 统一模拟、20Hz 发送快照；客户端 30Hz 发送输入，做本地预测与位置平滑，显示实测往返延迟。断线车辆由 AI 接管，房主离开自动移交。联机不暂停整个比赛，离开可以返回主菜单。

公网后端采用 Render Free，配置已保存在 `render.yaml`；当前正在完成账号内的服务部署与公网验证。上线前，Pages 可单人游玩；本地和局域网好友房间可用。不同外网设备下的延迟尚未验收。

GitHub Pages 与后端分开部署的构建、环境变量和免费主机限制见 `docs/部署配置.md`。后端 endpoint 通过仓库 Actions variable `VITE_SERVER_URL` 配置；Pages 上不把 github.io 当作 WebSocket 服务器。新赛道与物理的实现、验收和部署范围见 `docs/地图物理升级.md`。

## 源文件与检查

- `assets/source/kart*.blend`：三位车手及赛车的可编辑 Blender 源。
- `assets/source/build_kart.py`：程序化建模脚本。
- `public/models/`：原创 GLB 运行资产，每车低于 25k 三角面。
- `npm test`：竞速规则与真实 WebSocket 集成测试。
- `docs/实施计划.md`、`docs/测试报告.md`：需求依据、完成范围与真实验证状态。

素材与合成音效均为本项目原创；美术采取明亮圆润卡通方向。
