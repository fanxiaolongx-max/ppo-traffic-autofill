#!/bin/bash
# 自动抓取 www.ppo.gov.eg 证书并导入 macOS 钥匙串设置为永久信任

echo "📥 正在获取 www.ppo.gov.eg 的 SSL 证书..."
CERT_PATH="/tmp/ppo_gov_eg.crt"

echo | openssl s_client -servername www.ppo.gov.eg -connect www.ppo.gov.eg:443 2>/dev/null | openssl x509 > "$CERT_PATH"

if [ ! -s "$CERT_PATH" ]; then
  echo "❌ 获取证书失败，请检查网络连接。"
  exit 1
fi

echo "✅ 证书获取成功：$CERT_PATH"
echo "🔐 正在将证书导入 macOS 系统钥匙串并设置为永久信任（需要输入 Mac 开机密码）："

sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain "$CERT_PATH"

if [ $? -eq 0 ]; then
  echo ""
  echo "🎉 恭喜！www.ppo.gov.eg 已被 macOS 系统永久信任！"
  echo "👉 重启 Chrome 浏览器后将直接打开该网站，绝不再弹出任何不安全警告！"
else
  echo "❌ 导入失败，请检查权限。"
fi
