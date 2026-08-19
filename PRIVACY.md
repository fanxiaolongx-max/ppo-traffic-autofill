# Privacy Policy for PPO Egypt Traffic Violations Auto-Fill Extension
# 《PPO 埃及交通违章自动填表助手》用户隐私政策

**Last Updated / 最后更新日期**: August 18, 2026

---

## English Version

### 1. Overview
The **PPO Egypt Traffic Violations Auto-Fill** Chrome/Edge extension ("the Extension") is designed to provide users with convenient vehicle configuration management, on-screen Arabic letter keyboard input, and automated form-filling for traffic violation queries on the official Egyptian Public Prosecution portal (`https://www.ppo.gov.eg`).

Your privacy is our utmost priority. This Privacy Policy details how your information is handled.

### 2. Data Collection & Storage (100% Local)
- **Zero Cloud Transmission**: The Extension does **NOT** collect, transmit, store, or sell any of your personal data to any external server or third party.
- **Local Storage Only**: All user configurations (such as plate numbers, owner IDs, passport numbers, and historical query logs) are stored strictly on your local device via Chrome's `chrome.storage.local` API.
- **Direct Official Communication**: Any query action performed by the Extension communicates directly and exclusively with the official Egyptian Public Prosecution website (`https://www.ppo.gov.eg`).

### 3. Permissions Explanation
The Extension requests only the minimum necessary permissions to function:
- `storage`: Required to save your vehicle profiles and query history locally on your device.
- `tabs` & `activeTab`: Required to open, navigate, or switch to the official PPO query portal tab.
- `scripting`: Required to inject the helper keyboard panel and autofill fields on the official PPO website.
- `notifications`: Required to display desktop alerts when a query result is retrieved.
- `cookies`: Required solely to enable the manual "Reset Portal Session" button for clearing stuck APEX sessions on `ppo.gov.eg`.

### 4. Third-Party Services & Tracking
The Extension contains **NO** third-party analytics (e.g., Google Analytics), no tracking SDKs, no ads, and no telemetry.

### 5. Contact & Open Inquiries
If you have any questions or feedback regarding this Privacy Policy, please open an issue on our official GitHub repository.

---

## 中文版本

### 1. 概述
**PPO 埃及交通违章自动填表助手**（以下简称“本插件”）旨在为用户在访问埃及公诉机关交通门户网站（`https://www.ppo.gov.eg`）时提供常用车辆配置管理、阿拉伯字母软键盘快捷输入以及历史违章记录留存服务。

我们高度重视您的个人隐私与数据安全，本隐私政策旨在透明地说明我们如何处理您的数据。

### 2. 数据收集与存储（100% 本地离线存储）
- **零云端上传**：本插件**不收集、不上传、不转让、不出售**任何用户的个人隐私数据到任何外部云服务器或第三方。
- **纯本地存储**：您所保存的车辆车牌、护照号、身份证号以及所有历史查询数据，**严格仅保存在您本地浏览器的沙盒存储中（`chrome.storage.local`）**，完全由您本人控制。
- **单向直连官方**：所有查询指令与数据均仅直接与埃及公诉机关官方网站（`https://www.ppo.gov.eg`）通信，无任何中间服务器中转。

### 3. 插件权限使用说明
本插件遵循“最小必要权限原则”，仅申请实现核心功能所必需的权限：
- `storage`：用于在本地保存车辆配置信息与历史查询档案；
- `tabs` 与 `activeTab`：用于在浏览器中打开或激活官方违章查询网页；
- `scripting`：用于在官方页面渲染辅助悬浮面板并执行表单自动填入；
- `notifications`：用于在查询成功后向操作系统发送桌面结果通知；
- `cookies`：仅用于当用户主动点击“重置官网会话”时，清理官方网站卡顿的临时会话。

### 4. 第三方跟踪与广告
本插件**绝不包含任何第三方跟踪代码（如 Google Analytics）、无任何数据统计 SDK、无广告插件**。

### 5. 联系与支持
如果您对本隐私政策有任何疑问或改进建议，欢迎随时通过官方 GitHub 仓库提交 Issue。
