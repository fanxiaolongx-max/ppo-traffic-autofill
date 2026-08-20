# PPO 交通违章自动填表助手

版本：**1.0.4**<br>
适用浏览器：Google Chrome、Microsoft Edge（Manifest V3）<br>
目标网站：[埃及公诉机关交通违章门户](https://www.ppo.gov.eg/ppo/r/ppoportal/ppoportal/traffic)

这是一款面向埃及 PPO 交通违章查询页面的浏览器扩展，提供车辆资料保存、阿拉伯车牌快捷输入、网页自动填表、查询结果抓取和本地历史记录管理。

## 1.0.4 更新内容

- 修复 macOS 菜单栏托盘图标在暗色/透明菜单栏中不可见的问题
- 修复反向代理访问被错误记录为 `127.0.0.1`，查询与反馈统一记录可信来源的真实客户端 IP
- 建议反馈支持受限截图与文件附件，Admin 可鉴权预览或下载
- 检查更新支持公开更新清单及开发者私有仓库认证，并明确提示私有仓库 404 原因

- 移除「极速静默模式」及弹窗、历史页中的查询模式切换开关，查询统一走网页前台模式。
- 修复弹窗「仅填表」在非官网页面点击时会被强制自动提交查询的问题。
- 新增埃及当地深夜时段（00:00–06:00）查询前提醒：该时段官方后端服务常调不通，提醒可选择继续查询或改日间再查，当天只提示一次。时段按开罗时区判断，用户身处任何时区结果一致。
- 新增「官方后端服务暂时不可用」错误识别（`حدث خطأ أثناء معالجة الطلب`）：此前该错误落入通用兜底分支，会误导用户去核对车牌与证件，实际与填写内容无关。
- `trust_ppo_cert.sh` 改为补全官网缺失的中间证书，不再把网站证书当根证书信任；新增 `--check` / `--system` / `--revert` 参数。

## 1.0.2 更新内容

- 新增配置与草稿会完整保存护照格式、证件类型和数字模式。
- 弹窗改为表单区滚动、操作区固定；在较矮的浏览器弹窗中查询按钮仍保持可见。
- 历史记录与配置导入增加数据校验和 HTML 转义，CSV 导出增加规范转义与公式注入保护。
- 增加查询熔断与去重，避免相同表单重复提交。
- 修复官网表单未加载时可能持续刷新并重新派发任务的问题；达到等待上限后会安全停止并显示诊断提示。
- 查询成功、失败或超时后会清理恢复标记，避免页面刷新后反复启动旧查询。

## 主要功能

- 车牌阿拉伯字母快捷输入，支持拉丁数字、东阿拉伯数字和波斯数字。
- 护照与埃及身份证两种所有者证件类型。
- 多车辆/人员配置保存、切换、更新、删除和备份恢复。
- 网页前台模式：打开 PPO 官网，可视化填表并提交。
- 护照格式最多自动切换一次：带字母原版与去前缀格式之间重试，最多共两次提交。
- 查询结果、错误诊断、响应耗时和原始快照本地归档。
- 历史记录搜索、筛选、排序、卡片/表格视图及 JSON、CSV 导出。

## 防重复与熔断规则

扩展对容易形成循环的路径设置了明确上限：

- 护照格式：首次提交 + 最多 1 次替代格式重试。
- 待办表单检测：最多 15 次，每次间隔 300ms；仍未找到表单则停止，不再刷新页面。
- 前台查询监听：总计最多 25 秒；成功、失败或超时都会清除查询生命周期标记。
- 结果抓取：使用防并发锁和结果指纹，防止 MutationObserver 重复入库。

## 本地安装

### Chrome

1. 打开 `chrome://extensions/`。
2. 开启“开发者模式”。
3. 点击“加载已解压的扩展程序”。
4. 选择本项目根目录。

### Edge

1. 打开 `edge://extensions/`。
2. 开启“开发人员模式”。
3. 点击“加载解压缩的扩展”。
4. 选择本项目根目录。

## 发布包构建

当前商店版本为 `1.0.4`，重新打包时使用：

```bash
./package_extension.sh --no-bump
```

生成文件：

```text
dist/ppo-traffic-autofill-chrome-v1.0.4.zip
dist/ppo-traffic-autofill-edge-v1.0.4.zip
dist/ppo-traffic-autofill-chrome-latest.zip
dist/ppo-traffic-autofill-edge-latest.zip
```

带版本号的 Chrome、Edge ZIP 分别用于两个商店；`latest` 文件方便本地反复验证。两个浏览器目前都使用同一套 Manifest V3 源码，但使用独立文件名可以避免上架时选错包。正式上传前请确认商店当前已发布版本低于 `1.0.4`；如果商店已经发布过 `1.0.4`，则必须提升版本号后再提交。

## GitHub 自动构建与 Release

仓库内置 `.github/workflows/build-release.yml`：

- 每次推送到 `main` 后，自动将补丁版本递增一次，并同步更新扩展 Manifest、桌面 App、锁文件和 README；机器人版本提交使用 `[skip ci]`，不会形成重复触发或无限递增。
- 自动创建同版本 Git 标签，校验并打包 Chrome ZIP、Edge ZIP，以及 macOS Universal DMG/ZIP，随后创建 GitHub Release 并附上 4 个可下载文件。
- 手工推送形如 `v1.0.4` 的版本标签时仍会验证并构建该版本，但一般无需再手工创建标签。
- 标签、`manifest.json` 扩展版本与 `desktop-app/package.json` 桌面程序版本必须完全一致，否则任务会主动失败，防止发布错版本。
- macOS 使用 Universal 架构构建，可同时覆盖 Apple Silicon 与 Intel Mac。未配置签名密钥时仍会生成安装包，但正式分发建议按 `desktop-app/README.md` 配置签名和公证密钥。

通常只需推送代码：

```bash
git push origin main
```

本地 `dist/*.zip` 和 `desktop-app/dist/` 已加入 `.gitignore`，无需再把打包文件提交到仓库。

## 项目结构

```text
manifest.json          Manifest V3 配置与版本
background.js          网页查询调度、结果通知和服务器探测
content.js             官网填表、结果监听、重试与悬浮界面
popup.html/js/css      浏览器工具栏弹窗
history.html/js/css    历史记录与配置管理中心
utils.js               数字格式转换
_locales/              中文、英文、阿拉伯文商店与界面文案
icons/                 扩展图标
PRIVACY.md             隐私政策
STORE_LISTING.md       商店上架文案
package_extension.sh   校验与打包脚本
.github/workflows/     GitHub Actions 自动构建与 Release
desktop-app/           桌面 GUI、Web/API 服务与 Admin 管理后台
```

## 权限说明

- `storage`：保存配置、草稿、查询结果与历史记录。
- `tabs`、`activeTab`、`scripting`：打开 PPO 页面并执行自动填表。
- `notifications`：查询完成后显示本地系统通知。
- `cookies`：用户主动选择“重置官网会话”时清理 PPO 业务会话 Cookie；会保留 WAF 信任 Cookie。
- 主机权限仅覆盖 `ppo.gov.eg` 及其子域名。

## 隐私

扩展不包含独立服务器，不会把车辆、护照或查询历史发送给扩展开发者。资料保存在浏览器扩展存储中；执行查询时，用户填写的车牌与证件信息会提交给 PPO 官方网站。详细说明见 [PRIVACY.md](PRIVACY.md)。

## 已知限制

- 查询结果依赖 PPO 官方网站的页面结构、在线状态和 Oracle APEX 会话。
- 官网维护、WAF 拦截、会话过期或字段 ID 调整时，自动填表可能停止并显示诊断提示。
- 商店发布包不包含开发文档、截图和本地辅助脚本。
