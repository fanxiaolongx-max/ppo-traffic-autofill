# 埃及车辆违章查询 Agent Skill (PPO Traffic)

这是一个为 AI Agent（Google Antigravity、Claude Code、Cursor 等）打包的离线安装技能扩展，方便在其他项目或助手环境中直接调用埃及车辆违章查询中枢服务。

## 预配置信息
- **服务基地址**: `http://127.0.0.1:17654`
- **预配 API KEY**: `YOUR_API_KEY`

## 目录结构
```text
ppo-traffic/
├── SKILL.md            # Agent 指令定义与调用规范
├── README.md           # 安装与配置指南
└── scripts/
    └── ppo_cli.py      # 免第三方依赖的 Python 3 命令行客户端
```

## 安装方法

### 方式一：安装至 Antigravity 项目工作区
将解压后的 `ppo-traffic/` 文件夹复制到你当前工作区的 skills 目录：
```bash
mkdir -p .gemini/skills
cp -r ppo-traffic .gemini/skills/
```

### 方式二：全局安装给 Antigravity（所有工作区通用）
```bash
mkdir -p ~/.gemini/antigravity/skills
cp -r ppo-traffic ~/.gemini/antigravity/skills/
```

### 方式三：安装至 Claude Code 项目工作区
```bash
mkdir -p .claude/skills
cp -r ppo-traffic .claude/skills/
```

### 方式四：在终端直接使用 Python CLI
无需安装任何三方依赖，直接运行：
```bash
# 提交并等待结果
python3 scripts/ppo_cli.py query --letters "أ ف س" --number 3413 --passport "E12345678" --wait

# 检查系统与 PPO 官网健康度
python3 scripts/ppo_cli.py status

# 查看历史查询
python3 scripts/ppo_cli.py history --limit 5
```
