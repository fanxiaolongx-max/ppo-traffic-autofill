# PPO 交通违章表单自动填表插件 (مساعد مخالفات المرور)

专为埃及公诉机关交通门户 (`https://www.ppo.gov.eg/ppo/r/ppoportal/ppoportal/traffic`) 定制的 Chrome 插件。支持多车辆配置管理、阿拉伯字母快捷输入、自动填表与查询、实时罚款数据抓取与结果卡片展示。

## 目录结构
```text
ppo-traffic-autofill/
├── manifest.json      # 插件配置 (Manifest V3)
├── background.js      # 后台服务调度与结果提取
├── content.js         # 页面注入脚本及自动化填充逻辑
├── floating-ui.css    # 页面悬浮窗口样式
├── popup.html         # 浏览器工具栏弹窗
├── popup.js           # 弹窗交互与多配置管理
├── popup.css          # 弹窗样式
├── utils.js           # 阿拉伯数字/波斯数字/东阿拉伯数字转换工具
├── collector.js       # F12 开发者工具信息采集脚本
├── trust_ppo_cert.sh  # macOS 证书信任脚本
└── README.md          # 使用说明
```

## 安装与使用说明

### 1. 安装插件到 Chrome
1. 在 Chrome 浏览器地址栏输入 `chrome://extensions/` 并回车。
2. 开启右上角的 **开发者模式 (Developer mode)**。
3. 点击左上角的 **加载已解压的扩展程序 (Load unpacked)**。
4. 选择本项目所在文件夹 `ppo-traffic-autofill` 即可完成安装。

### 2. 功能特点
- **多配置管理**：支持保存多个常用车牌与护照配置，随时切换。
- **双操作模式**：
  - **浏览器右上角弹窗 (Popup)**：点击扩展图标快速查看/编辑配置，一键跳转填表。
  - **页面内置悬浮窗 (Floating Panel)**：在官方页面上自动浮现，支持自由拖拽、最小化、字母软键盘快捷输入与一键自动提交。
- **自动抓取与汇总**：查询完成后自动截停浏览器加载，提取总罚款金额、违章笔数及和解金额并在悬浮窗与弹窗中高亮显示。
