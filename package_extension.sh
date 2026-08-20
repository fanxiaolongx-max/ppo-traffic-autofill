#!/usr/bin/env bash
set -e

# ==============================================================================
# PPO Traffic AutoFill - Production Extension Packaging Script
# 支持自动递增版本号 (SemVer) 并生成符合 Chrome / Edge 商店标准的发布包
#
# 使用方法：
#   ./package_extension.sh            # 默认自动递增 Patch 版本号 (如 1.0.0 -> 1.0.1)
#   ./package_extension.sh 1.1.0      # 指定版本号为 1.1.0
#   ./package_extension.sh --no-bump  # 保持当前版本号不递增，重新打包
# ==============================================================================

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${PROJECT_DIR}"

ARG="$1"

# 1. 版本号解析与自增处理
OLD_VERSION=$(node -e "console.log(JSON.parse(require('fs').readFileSync('${PROJECT_DIR}/manifest.json', 'utf8')).version || '1.0.0')")

if [ "$ARG" = "--no-bump" ]; then
  NEW_VERSION="${OLD_VERSION}"
  echo "📌 保持当前版本号: v${NEW_VERSION}"
elif [ -n "$ARG" ]; then
  NEW_VERSION="${ARG}"
  node -e "
    const fs = require('fs');
    const m = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
    m.version = '${NEW_VERSION}';
    fs.writeFileSync('manifest.json', JSON.stringify(m, null, 2) + '\n');
  "
  echo "📌 已更新版本号: v${OLD_VERSION} -> v${NEW_VERSION}"
else
  NEW_VERSION=$(node -e "
    const fs = require('fs');
    const m = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
    const parts = (m.version || '1.0.0').split('.').map(n => parseInt(n, 10) || 0);
    while (parts.length < 3) parts.push(0);
    parts[2] += 1;
    const bumped = parts.join('.');
    m.version = bumped;
    fs.writeFileSync('manifest.json', JSON.stringify(m, null, 2) + '\n');
    console.log(bumped);
  ")
  echo "🚀 [版本递增] v${OLD_VERSION} -> v${NEW_VERSION}"
fi

CHROME_PACKAGE="ppo-traffic-autofill-chrome-v${NEW_VERSION}.zip"
EDGE_PACKAGE="ppo-traffic-autofill-edge-v${NEW_VERSION}.zip"
CHROME_LATEST="ppo-traffic-autofill-chrome-latest.zip"
EDGE_LATEST="ppo-traffic-autofill-edge-latest.zip"
OUTPUT_DIR="${PROJECT_DIR}/dist"

echo "🔍 [1/4] 开始验证项目代码完整性与语法..."
node --check "${PROJECT_DIR}/background.js" "${PROJECT_DIR}/content.js" "${PROJECT_DIR}/popup.js" "${PROJECT_DIR}/history.js" "${PROJECT_DIR}/utils.js"
node -e "JSON.parse(require('fs').readFileSync('${PROJECT_DIR}/manifest.json', 'utf8'))"
node -e "JSON.parse(require('fs').readFileSync('${PROJECT_DIR}/_locales/zh_CN/messages.json', 'utf8'))"
node -e "JSON.parse(require('fs').readFileSync('${PROJECT_DIR}/_locales/en/messages.json', 'utf8'))"
node -e "JSON.parse(require('fs').readFileSync('${PROJECT_DIR}/_locales/ar/messages.json', 'utf8'))"

echo "✅ 语法与 Manifest 校验全部通过！"

echo "📦 [2/4] 创建输出目录..."
mkdir -p "${OUTPUT_DIR}"
rm -f "${OUTPUT_DIR}/${CHROME_PACKAGE}" "${OUTPUT_DIR}/${EDGE_PACKAGE}"
rm -f "${OUTPUT_DIR}/${CHROME_LATEST}" "${OUTPUT_DIR}/${EDGE_LATEST}"

echo "🧹 [3/4] 正在打包生产文件 (排除开发辅助与临时文档)..."
zip -r "${OUTPUT_DIR}/${CHROME_PACKAGE}" \
  manifest.json \
  _locales/ \
  icons/ \
  background.js \
  content.js \
  floating-ui.css \
  popup.html \
  popup.js \
  popup.css \
  history.html \
  history.js \
  history.css \
  utils.js \
  -x "*.DS_Store" "*__MACOSX*"

# Chrome 与 Edge 都使用 Manifest V3；分别保留清晰的商店上传文件名。
cp "${OUTPUT_DIR}/${CHROME_PACKAGE}" "${OUTPUT_DIR}/${EDGE_PACKAGE}"
cp "${OUTPUT_DIR}/${CHROME_PACKAGE}" "${OUTPUT_DIR}/${CHROME_LATEST}"
cp "${OUTPUT_DIR}/${EDGE_PACKAGE}" "${OUTPUT_DIR}/${EDGE_LATEST}"

echo "🎉 [4/4] 打包成功！发布包已生成至："
echo "   📍 Chrome: ${OUTPUT_DIR}/${CHROME_PACKAGE}"
echo "   📍 Edge:   ${OUTPUT_DIR}/${EDGE_PACKAGE}"
echo "   📊 文件大小: $(du -h "${OUTPUT_DIR}/${CHROME_PACKAGE}" | cut -f1)"
echo ""
echo "👉 您可直接将上述 zip 包上传至 Chrome Web Store 开发者后台与 Microsoft Partner Center！"
