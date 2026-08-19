#!/usr/bin/env bash
set -e

# ==============================================================================
# PPO Traffic AutoFill - Production Extension Packaging Script
# 生成符合 Chrome Web Store / Edge Add-ons 商店规范的纯净发布包
# ==============================================================================

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACKAGE_NAME="ppo-traffic-autofill-v1.0.0.zip"
OUTPUT_DIR="${PROJECT_DIR}/dist"

echo "🚀 [1/4] 开始验证项目代码完整性与语法..."
node --check "${PROJECT_DIR}/background.js" "${PROJECT_DIR}/content.js" "${PROJECT_DIR}/popup.js" "${PROJECT_DIR}/history.js" "${PROJECT_DIR}/utils.js"
node -e "JSON.parse(require('fs').readFileSync('${PROJECT_DIR}/manifest.json', 'utf8'))"
node -e "JSON.parse(require('fs').readFileSync('${PROJECT_DIR}/_locales/zh_CN/messages.json', 'utf8'))"
node -e "JSON.parse(require('fs').readFileSync('${PROJECT_DIR}/_locales/en/messages.json', 'utf8'))"
node -e "JSON.parse(require('fs').readFileSync('${PROJECT_DIR}/_locales/ar/messages.json', 'utf8'))"

echo "✅ 语法校验全部通过！"

echo "📦 [2/4] 创建输出目录..."
mkdir -p "${OUTPUT_DIR}"
rm -f "${OUTPUT_DIR}/${PACKAGE_NAME}"

echo "🧹 [3/4] 正在打包生产文件 (排除开发辅助与临时文档)..."
cd "${PROJECT_DIR}"

zip -r "${OUTPUT_DIR}/${PACKAGE_NAME}" \
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

echo "🎉 [4/4] 打包成功！发布包已生成至："
echo "   📍 ${OUTPUT_DIR}/${PACKAGE_NAME}"
echo "   📊 文件大小: $(du -h "${OUTPUT_DIR}/${PACKAGE_NAME}" | cut -f1)"
echo ""
echo "👉 您可直接将此 zip 包上传至 Chrome Web Store 开发者后台与 Microsoft Partner Center！"
